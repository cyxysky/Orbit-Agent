# @cjfclonedeep/capability-sdk/execution/terminal

[English](TERMINAL.md) | [简体中文](TERMINAL.zh-CN.md) | [日本語](TERMINAL.ja.md)

This guide describes a subpath of `@cjfclonedeep/capability-sdk@0.3.0`, not a separate npm package. The tools package includes the dependencies used by these examples.

Local shell commands as a framework-neutral CapabilityProvider. No model, cloud sandbox or Agent loop is required. The Node adapter runs on the machine hosting your Agent service, using its OS account permissions. It does not run on a remote web client's computer.

## Install and first call

Use matching 0.3.0 workspace packages or published versions. Create the following file in the consuming project, with package.json set to type=module. This example needs no model/API key.

```sh
npm install @cjfclonedeep/capability-sdk
npm install -D typescript tsx @types/node
```

```ts
// terminal.ts — Node >=22.16, ESM TypeScript
import { randomUUID } from 'node:crypto';
import type { TerminalResult } from '@cjfclonedeep/capability-sdk/execution/terminal';
import { mountCapabilities } from '@cjfclonedeep/capability-sdk/host';
import { createCapabilityExecutor } from '@cjfclonedeep/capability-sdk';
import { createNodeTerminalCapability } from '@cjfclonedeep/capability-sdk/execution/terminal/node';

const mounted = await mountCapabilities({
  providers: [createNodeTerminalCapability({ cwd: process.cwd() })],
  context: { runId: randomUUID() },
  configurations: {
    'com.webpilot.terminal': { AGENT_TERMINAL_ENABLED: 'true' },
  },
});
// This single-user example grants terminal execution explicitly.
// A shared host supplies its authenticated user's permission policy.
const execute = createCapabilityExecutor({
  authorize(permissions) {
    if (permissions.some(permission => permission !== 'process:terminal')) {
      throw new Error('Permission denied.');
    }
  },
});
const resolved = mounted.tools.terminal;
async function call(raw: unknown) {
  const input = resolved.tool.input.parse(raw);
  return execute(resolved, { invocationId: randomUUID() },
    context => resolved.tool.execute(input, context));
}
try {
  console.log(mounted.skillCatalog.instructions('eager'));
  const created = await call({ action: 'create', reason: 'Open a reusable terminal', name: 'Workspace' });
  if (!created.ok) throw new Error(created.error.message);
  const terminalId = (created.data as TerminalResult).terminal!.terminalId;
  let result = await call({
    action: 'run', reason: 'Inspect the local working directory', terminalId,
    command: process.platform === 'win32' ? 'Get-Location' : 'pwd', yieldMs: 1000,
  });
  console.log(result);
  while (result.ok && (result.data as TerminalResult).terminal?.status === 'running') {
    result = await call({
      action: 'wait', reason: 'Wait for command completion', terminalId,
      cursor: (result.data as TerminalResult).cursor, yieldMs: 30000,
    });
    console.log(result);
  }
  if (!result.ok) throw new Error(result.error.message);
} finally {
  await mounted.dispose();
}
```

```sh
npx tsx terminal.ts
```

## Operations

- `create`: optional name, cwd, cols and rows. Returns a reusable terminalId. `list` discovers existing terminals.
- `run`: terminalId, command, optional timeoutMs and yieldMs. Commands reuse the same shell, directory, variables and environment. A busy terminal rejects a second run.
- `read`: terminalId and optional cursor; immediately reads retained output without consuming another reader's buffer.
- `wait`: terminalId, optional cursor and yieldMs; waits for command completion and returns subsequent output.
- `write`: terminalId and input; sends raw interactive input, including `\r` for Enter.
- `interrupt`: Ctrl+C, with terminal termination if the foreground command remains stuck.
- `resize`: cols/rows. `rename`: name. `close` ends the terminal and descendants but retains output; `delete` also removes the record.

Every action requires reason. yieldMs is 0–30000; it bounds a call's wait, not command lifetime. A running response is not command success. Only command.status=succeeded and command.exitCode=0 establish success. Failed, interrupted or timed-out run/wait results include TerminalResult in error.details.

## Runtime behavior

Real PTYs run in isolated native host processes. auto selects Windows PowerShell on Windows and Bash elsewhere; powershell, pwsh and bash are supported, with powershell/pwsh required on Windows. Programs receive a terminal with interactive input, ANSI output and resizing. Shell profiles are not loaded. Invoke package managers directly, including .ps1/.cmd wrappers; no detached process or log-file polling is needed.

A standalone createNodeTerminalCapability runtime owns and disposes its manager. To retain terminals across model requests, use the package-owned createTerminalWorkspaceRegistry: userId and sessionId isolate workspaces, and capability() returns non-owning tool handles. Model calls, compression and normally completed turns retain terminals. On explicit conversation stop, closure or deletion, call stop({ ownerId, workspaceId }) to close shells and descendants and delete their records; call dispose() at service shutdown. Missing terminals cannot resume after a backend restart and commands are never replayed automatically.

The Node manager provides subscribe for live output/state events. Orbit streams these through its authorized terminal SSE endpoint; reconnect replays retained output. Raw output has absolute cursors; model reads remove terminal control codes. stdout/stderr are combined by the PTY, and stderr output alone is not failure. The bounded buffer retains its tail and marks truncated=true. Up to 64 records remain until explicitly deleted. timeoutMs=0 disables command deadlines; positive deadlines interrupt the foreground command.

## Configuration

Windows supports powershell/pwsh only. The shell joins a Windows Job before executing user commands, so its descendants terminate when it exits. If job assignment is unavailable, the command fails before execution. PowerShell's legacy native argument quoting rules still apply; prefer script files for complex nested quotes.

| Key | Default |
| --- | --- |
| `AGENT_TERMINAL_ENABLED` | `false` |
| `AGENT_TERMINAL_CWD` | application cwd |
| `AGENT_TERMINAL_SHELL` | `auto` |
| `AGENT_TERMINAL_TIMEOUT_MS` | `0` |
| `AGENT_TERMINAL_MAX_OUTPUT_CHARS` | `50000` |
| `AGENT_TERMINAL_MAX_PROCESSES` | `4` |

Shell and initial directory apply when creating a terminal; manager configuration updates apply to subsequent operations. An explicit factory cwd overrides AGENT_TERMINAL_CWD. Direct createNodeTerminalOperations callers own authorization and lifecycle themselves. Optional env is supplied by the host; omitted env inherits the service environment.

## Agent integration

Use tool.input.jsonSchema as the model's parameters schema, parse arguments before execution, and share one createCapabilityExecutor for concurrency and permission hooks. Supply the Skill instructions to the model. The host owns operation approval, user identity and cancellation. Orbit exposes settings under Local Terminal and routes run/write through its existing approval flow.

AI SDK consumers can pass this provider and configuration to mountAISDKCapabilities from @cjfclonedeep/capability-sdk/ai-sdk, then supply its agentOptions to their own Agent. Keep the mounted runtime until all tool calls finish. The core and Node entrypoints do not import AI SDK.

The public exports are the provider/contract at the root, Node factories at /node, settings at /settings, the Skill at /runtime-skill and MCP helpers at /mcp. See [MCP integration](TERMINAL-MCP.md).

## Conversation workspaces and terminal UI

The /workspaces entry owns lifecycle management; /http exposes terminalHttpResponse for operations and SSE; /client provides createHttpTerminalClient for a host route; /react exports TerminalWorkspace with create, switch, rename, interrupt, close, delete, streaming output and inline terminal input. The prompt follows the last output line. Dismissing the UI retains terminals. Hosts supply identity, workspace authorization, configuration and lifecycle bindings. Per-model-request disposal must not dispose a shared workspace.

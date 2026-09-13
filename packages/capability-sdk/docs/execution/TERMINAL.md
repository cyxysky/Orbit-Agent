# @cjfclonedeep/capability-sdk/execution/terminal

[English](TERMINAL.md) | [简体中文](TERMINAL.zh-CN.md) | [日本語](TERMINAL.ja.md)

This guide describes a subpath of `@cjfclonedeep/capability-sdk@0.2.1`, not a separate npm package. The tools package includes the dependencies used by these examples.

Local shell commands as a framework-neutral CapabilityProvider. No model, cloud sandbox or Agent loop is required. The Node adapter runs on the machine hosting your Agent service, using its OS account permissions. It does not run on a remote web client's computer.

## Install and first call

Use matching 0.2.1 workspace packages or published versions. Create the following file in the consuming project, with package.json set to type=module. This example needs no model/API key.

```sh
npm install @cjfclonedeep/capability-sdk
npm install -D typescript tsx @types/node
```

```ts
// terminal.ts — Node >=22.16, ESM TypeScript
import { randomUUID } from 'node:crypto';
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
  let result = await call({
    action: 'run', reason: 'Inspect the local working directory',
    command: process.platform === 'win32' ? 'Get-Location' : 'pwd',
    yieldMs: 1000,
  });
  console.log(result);
  while (result.ok && (result.data as { status: string }).status === 'running') {
    result = await call({
      action: 'read', reason: 'Collect remaining command output',
      sessionId: (result.data as { sessionId: string }).sessionId, yieldMs: 1000,
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

- `run`: command, optional cwd, stdin, keepStdinOpen, timeoutMs and yieldMs. Each run starts a fresh shell. Relative cwd resolves against the configured directory; it is not a filesystem sandbox.
- `read`: sessionId and optional yieldMs. Returns new stdout/stderr since the previous read, with status, exitCode, signal and truncation metadata.
- `write`: sessionId, stdin, optional closeStdin and yieldMs. Start with keepStdinOpen=true before sending input; otherwise run closes stdin after its initial input.
- `stop`: sessionId. Terminates the process tree and waits for closure.

Every action requires reason. yieldMs is 0–10000 (default 1000); run may return status=running and must be followed with read, not a duplicate run. Process failures, timeout and cancellation return ok=false with the complete TerminalResult in error.details. Success/running results put it in data. Never treat a nonzero exit as success.

## Runtime behavior

auto selects Windows PowerShell on Windows and Bash elsewhere. The host can select powershell, pwsh, bash or sh; install the chosen shell first. Commands run with hidden Windows windows and no shell profile. This is a pipe-based runner, not a PTY: TTY-only programs and full-screen terminal applications are unsupported. Variables and cd changes do not persist between separate run actions.

A runtime owns its process sessions. Reuse that runtime for run/read/write/stop; dispose terminates all remaining process trees. Orbit mounts it for an Agent turn, so these sessions do not survive that turn or server restart. Each process has a host-bounded timeout and output buffer; stdout/stderr each receive half of the configured output budget. Overflow retains the tail and sets truncated=true without killing the command. At most 64 session records are retained; the oldest completed records are evicted first.

## Configuration

Windows supports powershell/pwsh only. The shell joins a Windows Job before executing user commands, so its descendants terminate when it exits. If job assignment is unavailable, the command fails before execution. PowerShell's legacy native argument quoting rules still apply; prefer script files for complex nested quotes.

| Key | Default |
| --- | --- |
| `AGENT_TERMINAL_ENABLED` | `false` |
| `AGENT_TERMINAL_CWD` | application cwd |
| `AGENT_TERMINAL_SHELL` | `auto` |
| `AGENT_TERMINAL_TIMEOUT_MS` | `120000` |
| `AGENT_TERMINAL_MAX_OUTPUT_CHARS` | `50000` |
| `AGENT_TERMINAL_MAX_PROCESSES` | `4` |

All settings apply to newly mounted runtimes. An explicit factory cwd overrides AGENT_TERMINAL_CWD. Direct createNodeTerminalOperations callers own authorization and lifecycle themselves. Optional env is supplied by the host; omitted env inherits the service environment.

## Agent integration

Use tool.input.jsonSchema as the model's parameters schema, parse arguments before execution, and share one createCapabilityExecutor for concurrency and permission hooks. Supply the Skill instructions to the model. The host owns operation approval, user identity and cancellation. Orbit exposes settings under Local Terminal and routes run/write through its existing approval flow.

AI SDK consumers can pass this provider and configuration to mountAISDKCapabilities from @cjfclonedeep/capability-sdk/ai-sdk, then supply its agentOptions to their own Agent. Keep the mounted runtime until all tool calls finish. The core and Node entrypoints do not import AI SDK.

The public exports are the provider/contract at the root, Node factories at /node, settings at /settings, the Skill at /runtime-skill and MCP helpers at /mcp. See [MCP integration](TERMINAL-MCP.md).

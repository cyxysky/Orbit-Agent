# @webpilot/capability-code-sandbox

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

Run bounded JavaScript/Python computations with a replaceable executor.

This README is a complete integration entrypoint. Follow steps 1–4 for any TypeScript Agent framework, or use the AI SDK/MCP routes below. All named source files are created in **your consuming project**, not inside this package.

## 1. Install and prepare

Use Node.js >=22.16 and ESM TypeScript. These examples match the 0.1.0 workspace contracts. Install matching Capability versions from your configured npm registry. If a version is unpublished, obtain the matching release tarballs/workspace packages from the maintainer; a registry 404 is not a runtime failure. Do not mix unrelated releases. For a new project:

```sh
npm init -y
npm pkg set type=module
npm install @webpilot/capability-code-sandbox @webpilot/capability-sdk @webpilot/capability-host
npm install -D typescript tsx @types/node
```

This local example runs trusted computation and prints a small result. It is not OS isolation. JavaScript runs as ESM; use `import`, not bare `require`. Python needs an installed interpreter (`pythonExecutable` may select it). Optional packages use exact versions such as `lodash@4.17.21` or `requests==2.32.3`.

For an existing isolated HTTP runner, use `createHttpCodeSandboxCapability({ url, token })` from `/remote`; the consuming host must deploy that runner independently. `AGENT_CODE_SANDBOX_BACKEND` alone does not change the explicitly chosen factory. The local factory cannot enforce `networkMode: "none"`; CPU/memory/network isolation needs the execution backend.

The minimal factory does not publish output files. If code creates `outputs/` files, wrap `createNodeProcessCodeSandbox` or `createHttpCodeSandboxExecutor` using `createCodeSandboxCapability({ createExecutor })`: persist each returned internal `files[].base64` payload, replace `files` with `artifacts`, implement `readFile`, and resolve `artifactInputs` to transport `inputFiles`. Never return internal Base64 to the model. A concrete artifact adapter is provided below. Runtime disposal removes the local executor workspace, so store published artifacts elsewhere. Stdout/stderr truncation is reported separately from process failure.

## 2. Create the provider

Save as `provider.ts`. This file creates the provider and exports the first valid call, explicit configuration overrides and host cleanup.

```ts
import { createNodeCodeSandboxCapability } from '@webpilot/capability-code-sandbox/node';
 const provider = createNodeCodeSandboxCapability({
   workspaceDirectory: (context) => `./agent-data/code/${context.runId}`,
 });

export const providers = [provider];
export const configurations = {
  "com.webpilot.code-sandbox": {
    "AGENT_CODE_SANDBOX_ENABLED": "true",
    "AGENT_CODE_SANDBOX_BACKEND": "local"
  }
};
export const exampleCall = {
  "name": "codeSandbox",
  "input": {
    "action": "run",
    "reason": "Check JavaScript execution",
    "language": "javascript",
    "code": "console.log(JSON.stringify({ total: [1, 2, 3].reduce((a, b) => a + b, 0) }));"
  }
};
export async function cleanup() {  }
```

## 3. Mount, validate and execute

Save as `integration.ts`. There is one shared executor per run, preserving serial concurrency groups. Parsing, cancellation, policy hooks and cleanup are part of the integration, not optional model behavior.

```ts
import { randomUUID } from 'node:crypto';
import { mountCapabilities, EnvironmentCapabilityConfigStore } from '@webpilot/capability-host';
import { createCapabilityExecutor, disposeOnce,
  type CapabilityExecutionPolicyOptions } from '@webpilot/capability-sdk';
import { providers, configurations, cleanup } from './provider.js';

export async function openCapabilities(options: {
  policy: CapabilityExecutionPolicyOptions;
  signal?: AbortSignal;
  beforeInvoke?: (name: string, input: unknown) => void | Promise<void>;
}) {
  const mounted = await mountCapabilities({
    providers, configurations,
    context: { runId: randomUUID(), abortSignal: options.signal },
    configStore: new EnvironmentCapabilityConfigStore(process.env),
  }).catch(async error => { await cleanup(); throw error; });
  const execute = createCapabilityExecutor(options.policy);
  const tools = Object.values(mounted.tools).map(resolved => ({
    name: resolved.publicName,
    description: resolved.tool.description,
    inputSchema: resolved.tool.input.jsonSchema,
    inputExamples: resolved.tool.inputExamples,
    async execute(rawInput: unknown, call: { id?: string; signal?: AbortSignal } = {}) {
      const signals = [mounted.abortSignal, call.signal].filter(
        (value): value is AbortSignal => Boolean(value));
      const context = { invocationId: call.id || randomUUID(),
        abortSignal: signals.length ? AbortSignal.any(signals) : undefined };
      try {
        const input = resolved.tool.input.parse(rawInput);
        await options.beforeInvoke?.(resolved.publicName, input);
        return await execute(resolved, context,
          execution => resolved.tool.execute(input, execution));
      } catch (error) {
        context.abortSignal?.throwIfAborted();
        return { ok: false as const, error: {
          code: 'host-tool-invocation-failed',
          message: error instanceof Error ? error.message : String(error),
        } };
      }
    },
  }));
  return {
    tools,
    instructions: mounted.skillCatalog.instructions('eager'),
    snapshot: mounted,
    dispose: disposeOnce(async () => {
      try { await mounted.dispose(); } finally { await cleanup(); }
    }),
  };
}
```

Save as `policy.ts`. This explicitly configured single-user example grants its selected providers. In a shared Agent, connect these hooks to your existing authenticated permission and action approval logic. Prerequisites declared by a tool need a `policy.prerequisite` handler; it must verify the named condition or throw.

```ts
import type { CapabilityExecutionPolicyOptions } from '@webpilot/capability-sdk';
import { providers } from './provider.js';

// This sample host grants the permissions of its explicitly configured providers.
// Replace this set with your authenticated user's grants in a shared service.
const grants = new Set(providers.flatMap(provider => [...(provider.manifest.permissions || [])]));
export const policy: CapabilityExecutionPolicyOptions = {
  authorize(permissions) {
    for (const permission of permissions) {
      if (!grants.has(permission)) throw new Error(`Permission denied: ${permission}`);
    }
  },
  reportProgress(event) { console.error(event.phase, event.message); },
};

// Put your existing action/draft approval check here, before calling the tool.
// No additional action-level approval is configured by this single-user example.
export async function beforeInvoke(_name: string, _input: unknown): Promise<void> {}
```

Save as `first-call.ts`, then run `npx tsx first-call.ts`. No model/API key is needed for this first call; the provider-specific prerequisites above still apply.

```ts
import { openCapabilities } from './integration.js';
import { exampleCall } from './provider.js';
import { policy, beforeInvoke } from './policy.js';
const runtime = await openCapabilities({ policy, beforeInvoke });
try {
  const tool = runtime.tools.find(tool => tool.name === exampleCall.name);
  if (!tool) throw new Error(`Tool not mounted: ${exampleCall.name}`);
  const result = await tool.execute(exampleCall.input);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} finally { await runtime.dispose(); }
```

## 4. Attach to your Agent

Map the returned objects to your framework's native tool registration. These are real fields, not a dependency on a hypothetical `createAgent` API:

| This integration | Your Agent |
| --- | --- |
| `runtime.tools[].name` | Tool name |
| `.description` | Model-visible description |
| `.inputSchema` | JSON Schema / native schema converter |
| `.execute(input, { id, signal })` | Tool callback; pass the model call ID and cancellation |
| `runtime.instructions` | Append to the system/Agent instructions before the first model call |
| `runtime.dispose()` | Await after the entire run/session finishes |

On each model step: send the tools and instructions → receive a tool call → parse its JSON arguments once if the framework supplies a string → find the tool by its exact name → await `execute` → append the **complete result** as a tool-result message associated with that same call ID → call the model again. Stop when the model returns a final answer or your step/cancellation limit is reached. Keep the mounted runtime alive through this loop.

Preserve `ok`, `data`, `content`, and `error` (including code/retryable/details), not just summary. For text-only results use `JSON.stringify(result)`. For vision, map image bytes to your model's native image parts; a stored path or JSON serialization is not an image input. Use artifact URLs without inventing IDs or URLs. Lazy Skill loading needs an explicit Skill reader and host-owned loaded-state/availability rules; the eager example avoids that additional integration.

The next section is a complete concrete Agent implementation using AI SDK. For other frameworks only the native tool/model/message mapping changes; the capability execution boundary above stays the same.

## AI SDK: complete model-driven Agent

```sh
npm install @webpilot/capability-adapter-ai-sdk "ai@>=7 <8" @ai-sdk/openai-compatible
```

Use a chat-completions-compatible provider that supports tools. Set `AGENT_MODEL_BASE_URL` (including its API prefix), `AGENT_MODEL_ID`, and optionally `AGENT_MODEL_API_KEY` in the process environment. Save as `agent.ts` alongside `provider.ts` and `policy.ts`, then run `npx tsx agent.ts "your task"`. This is an alternative to first-call.ts, not a second mount inside it. The initial prompt only asks for tool descriptions; supply your intended task to execute operations.

```ts
import { randomUUID } from 'node:crypto';
import { ToolLoopAgent, stepCountIs } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { mountAISDKCapabilities, EnvironmentCapabilityConfigStore } from '@webpilot/capability-adapter-ai-sdk';
import { providers, configurations, cleanup } from './provider.js';
import { policy, beforeInvoke } from './policy.js';

const baseURL = process.env.AGENT_MODEL_BASE_URL;
const modelId = process.env.AGENT_MODEL_ID;
if (!baseURL || !modelId) throw new Error('Set AGENT_MODEL_BASE_URL and AGENT_MODEL_ID');
const modelProvider = createOpenAICompatible({ name: 'agent-provider', baseURL,
  apiKey: process.env.AGENT_MODEL_API_KEY });
const abort = new AbortController();
const cancel = () => abort.abort(new Error('Agent interrupted'));
process.once('SIGINT', cancel);
let runtime: Awaited<ReturnType<typeof mountAISDKCapabilities>> | undefined;
try {
  runtime = await mountAISDKCapabilities({
    providers, configurations,
    context: { runId: randomUUID(), abortSignal: abort.signal },
    configStore: new EnvironmentCapabilityConfigStore(process.env),
    skills: { mode: 'eager' },
    adapter: { policy, async execute(call) {
      await beforeInvoke(call.resolvedTool.publicName, call.input);
      return call.invoke();
    } },
  });
  const agent = new ToolLoopAgent({ model: modelProvider.chatModel(modelId),
    ...runtime.agentOptions, stopWhen: stepCountIs(10) });
  const result = await agent.generate({
    prompt: process.argv[2] || 'Describe the available tools and their intended usage.',
    abortSignal: abort.signal,
  });
  console.log(result.text);
} finally {
  process.removeListener('SIGINT', cancel);
  try { await runtime?.dispose(); } finally { await cleanup(); }
}
```

## MCP: stdio, HTTP server and client

Use the self-contained [MCP tutorial](MCP.md) shipped with this package. It includes dependency installation, a stdio process, a listening stateful HTTP server, client discovery/calls, a model-driven client Agent, cancellation, authentication boundaries and shutdown. Reuse provider.ts and policy.ts above. A remote client needs only the MCP URL and client dependencies; it does not import this capability.

Do not expose a server-local file URL as a remote download. Follow this package's artifact/storage requirements above. The MCP server owns the execution environment; the caller's local files, browser and desktop are not automatically available there.

## Configuration and lifecycle

Settings belong to `provider.manifest.configuration.settings`. Inspect each definition for key, defaultValue, control, secret, range/options and applyMode; generate your settings UI from these definitions. Values are strings. Environment values are read only when you supply EnvironmentCapabilityConfigStore; explicit configurations[capabilityId] override stored/environment values. Configuration is injected when mounting. Use a stable user/workspace scope for durable state and remount when applicable settings change. Await disposal, including after model failure/cancellation.

The following table lists literal defaults from the package settings; dynamic definitions remain available through the manifest. `runtime` means remount for the new run; `startup` also requires restarting the owning driver/service.

| Key | Default | Apply mode |
| --- | --- | --- |
| `AGENT_CODE_SANDBOX_ENABLED` | `false` | `runtime` |
| `AGENT_CODE_SANDBOX_BACKEND` | `remote` | `runtime` |
| `AGENT_CODE_SANDBOX_RUNNER_URL` | `http://webpilot-code-sandbox:18100` | `runtime` |
| `AGENT_CODE_SANDBOX_RUNNER_TOKEN` | `` | `runtime` |
| `AGENT_CODE_SANDBOX_TIMEOUT_MS` | `30000` | `runtime` |
| `AGENT_CODE_SANDBOX_INSTALL_TIMEOUT_MS` | `120000` | `runtime` |
| `AGENT_CODE_SANDBOX_MAX_OUTPUT_CHARS` | `30000` | `runtime` |
| `AGENT_CODE_SANDBOX_NETWORK_MODE` | `full` | `runtime` |
| `AGENT_CODE_SANDBOX_ALLOW_PACKAGE_INSTALL` | `true` | `runtime` |
| `AGENT_CODE_SANDBOX_MAX_PACKAGES` | `16` | `runtime` |
| `AGENT_CODE_SANDBOX_MAX_CONCURRENCY` | `2` | `runtime` |
| `AGENT_CODE_SANDBOX_MEMORY_MB` | `512` | `runtime` |
| `AGENT_CODE_SANDBOX_CPU_LIMIT` | `1` | `runtime` |
| `AGENT_CODE_SANDBOX_PIDS_LIMIT` | `128` | `runtime` |
| `AGENT_CODE_SANDBOX_WORKSPACE_MB` | `256` | `runtime` |

## Troubleshooting and completion criteria

- Module not found: check published exports, aligned versions and Node/ESM setup; install the selected entrypoint's optional peers.
- Tool missing: inspect `runtime.tools`, enabled capability IDs and allowed names; do not guess names from folder names.
- Validation failure: use the actual inputSchema and parser error, not a copied schema from a different entrypoint.
- Disabled/unavailable operation: check normalized settings, selected backend, installed binaries and supplied host callbacks.
- Skill not followed: append eager instructions before the model call, or implement the lazy reader and availability policy.
- A timeout is not proof that a side effect did not happen. Inspect stored/live state before retrying.
- Integration is complete when the first call returns `ok: true`, the Agent receives the same tool schema and full result, required artifacts/images are usable by the caller, and the owning runtime closes without leaked resources.

## Published entrypoints

- `@webpilot/capability-code-sandbox`
- `@webpilot/capability-code-sandbox/node`
- `@webpilot/capability-code-sandbox/remote`
- `@webpilot/capability-code-sandbox/mcp`
- `@webpilot/capability-code-sandbox/runtime-skill`
- `@webpilot/capability-code-sandbox/settings`

## Publishing sandbox output files

Optional replacement for the provider creation in provider.ts. Keep its configurations/exampleCall/cleanup exports, but replace the local factory with this wrapper; remove the duplicate provider export if combining snippets. It implements a per-run artifact registry, output publication, bounded content pages and later input mounts. To survive server restarts, persist the registry metadata in your own store and serve artifact bytes through a download route. The worker owns only its temporary directory. For an HTTP runner replace the worker factory with createHttpCodeSandboxExecutor({ url, token }) from /remote. Output channel limits are 16 files, 10 MB/file and 32 MB total; symlinks and workspace escapes are rejected by the runner.

The production runner and Dockerfile mentioned in the existing repository reference belong to the Orbit application and are not shipped in this npm package. A standalone host must supply an isolated runner implementing POST /execute and GET /health (the /remote client), or its own CodeSandboxExecutor. The local example is explicitly the supported trusted-machine path.

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCodeSandboxCapability, type CodeSandboxArtifact } from '@webpilot/capability-code-sandbox';
import { createNodeProcessCodeSandbox } from '@webpilot/capability-code-sandbox/node';

export const provider = createCodeSandboxCapability({
  createExecutor(context) {
    const worker = createNodeProcessCodeSandbox({
      workspaceDirectory: path.resolve('./agent-data/code-work', context.runId),
    });
    // Published files are outside the disposable worker directory.
    const directory = path.resolve('./agent-data/code-artifacts', context.runId);
    const artifacts = new Map<string, CodeSandboxArtifact & { absolutePath: string }>();
    function lookup(id: string) {
      const artifact = artifacts.get(id);
      if (!artifact) throw new Error('Unknown artifact in this run');
      return artifact;
    }
    return {
      async run(input, execution) {
        const inputFiles = await Promise.all((input.artifactInputs || []).map(async item => {
          const artifact = lookup(item.artifactId);
          return { path: item.path, base64: (await readFile(artifact.absolutePath)).toString('base64') };
        }));
        const result = await worker.run({ ...input, artifactInputs: undefined, inputFiles }, execution);
        const { files = [], ...publicResult } = result;
        const published: CodeSandboxArtifact[] = [];
        await mkdir(directory, { recursive: true });
        for (const file of files) {
          const id = randomUUID();
          const fileName = path.basename(file.path);
          const target = path.join(directory, id);
          const bytes = Buffer.from(file.base64, 'base64');
          await writeFile(target, bytes, { flag: 'wx' });
          const artifact: CodeSandboxArtifact = { artifactId: id, fileName,
            size: bytes.length, mediaType: 'application/octet-stream',
            url: pathToFileURL(target).href, downloadUrl: pathToFileURL(target).href };
          artifacts.set(id, { ...artifact, absolutePath: target });
          published.push(artifact);
        }
        return { ...publicResult, artifacts: published };
      },
      async readFile(input) {
        const { absolutePath, ...artifact } = lookup(input.artifactId);
        const bytes = await readFile(absolutePath);
        const offset = Math.min(bytes.length, Math.max(0, input.offset || 0));
        const end = Math.min(bytes.length, offset + Math.min(65536, Math.max(1, input.limit || 8192)));
        const encoding = input.encoding || 'utf8';
        return { ...artifact, encoding, content: bytes.subarray(offset, end).toString(encoding),
          offset, nextOffset: end < bytes.length ? end : undefined, totalBytes: bytes.length };
      },
      health: () => worker.health?.() || Promise.resolve({ status: 'healthy' as const }),
      dispose: () => worker.dispose?.() || Promise.resolve(),
    };
  },
});
```

## Additional package reference

The following pre-existing reference includes focused API fragments and application integration notes. The complete runnable entrypoints are the numbered tutorial above; do not concatenate unrelated snippets.

## @webpilot/capability-code-sandbox

Bounded Python and JavaScript execution for agents. The portable core accepts
an injected executor. The local Node adapter is only for trusted single-machine
development; production deployments should use the HTTP runner in
`Dockerfile.code-sandbox`.

### TypeScript Agent framework integration

```ts
import { createNodeCodeSandboxCapability } from '@webpilot/capability-code-sandbox/node';

const provider = createNodeCodeSandboxCapability({
  workspaceDirectory: './agent-workspaces/code',
});
```

Register this provider with `mountCapabilities()`, expose the resolved
`codeSandbox` tool through the consuming framework, and inject the package Skill
before execution.

The tool accepts exact-version dependencies through `packages`, for example
`lodash@4.17.21` or `requests==2.32.3`. JavaScript dependencies are installed
with npm lifecycle scripts disabled; Python dependencies are installed into a
disposable target directory. The host must enforce the declared process,
network, and workspace policy in addition to the package's bounded runner.

JavaScript runs as Node.js ESM (`.mjs`): use `import`, including for installed
packages. Bare `require` is not defined; use `createRequire(import.meta.url)`
explicitly if needed. Each execution has a disposable directory. Write files
under `outputs/` (created by the runner), or list extra relative `outputFiles`.
The runner exports them before cleanup over a separate file channel: 16 files,
10 MB per file, 32 MB total. Symlinks and workspace escapes are rejected.
The application host persists them and returns `artifacts` with IDs, preview
URLs and download URLs. `readFile` reads content in bounded byte pages;
`inputFiles: [{ artifactId, path: 'inputs/file.png' }]` mounts a full saved file
in a later execution. Files remain available after runner cleanup and refresh.

Standalone framework hosts must persist the executor's internal `files` payload
and return artifact metadata, and implement `readFile` / artifact input lookup.
Never send the internal Base64 transport payload into the model transcript.

`maxOutputChars` optionally requests 1,000–200,000 combined stdout/stderr
characters, capped by `AGENT_CODE_SANDBOX_MAX_OUTPUT_CHARS` (default 30,000).
Excess output is discarded while the process continues under its timeout;
`truncated` and `outputLimitExceeded` mark incomplete captured output. Successful
process completion does not imply complete output. Return compact logs and use
file exports for binary data; stdout truncation does not truncate exported files.
Older remote runners
that kill on output overflow must be restarted/upgraded to use truncation.

### Production runner

For an existing trusted local HTTP-runner setup, run `npm run code-sandbox:start`
from the application root. This loads `.env.local` / `.env`, binds to the loopback
`AGENT_CODE_SANDBOX_RUNNER_URL`, and uses `AGENT_CODE_SANDBOX_RUNNER_TOKEN` (or
`CODE_SANDBOX_RUNNER_TOKEN`). Keep the runner process running alongside Orbit;
starting Orbit alone does not start this separate service. A refused connection
to its port means the runner is unavailable, not that the submitted code failed.
This local launcher does not provide container isolation.

Build and start the isolated runner beside the Orbit service:

```sh
docker compose up -d --build
```

Set `CODE_SANDBOX_RUNNER_TOKEN` to a long random value. The runner has no
Orbit artifacts or application environment mounted, runs as a non-root user,
uses a read-only root filesystem, and has container-level CPU, memory, process,
and temporary-space limits. Its outbound network is enabled so code and package
installation can use the network. This is intentionally full outbound network
access, not a domain allowlist; add an egress proxy/firewall before exposing
the runner to untrusted tenants. Use the `local` backend only in a trusted
development environment.

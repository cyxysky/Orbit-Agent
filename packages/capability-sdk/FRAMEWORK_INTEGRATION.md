# TypeScript Agent framework integration

[English](FRAMEWORK_INTEGRATION.md) | [简体中文](FRAMEWORK_INTEGRATION.zh-CN.md) | [日本語](FRAMEWORK_INTEGRATION.ja.md)

Define portable Capability contracts and shared execution/lifecycle primitives.

This README is a complete integration entrypoint. Follow steps 1–4 for any TypeScript Agent framework, or use the AI SDK/MCP routes below. All named source files are created in **your consuming project**, not inside this package.

## 1. Install and prepare

For structured charts, maps and other registered output, also follow
[Registered output across frameworks](#registered-output-across-frameworks).

Use Node.js >=22.16 and ESM TypeScript. These examples match the 0.1.0 workspace contracts. Install matching Capability versions from your configured npm registry. If a version is unpublished, obtain the matching release tarballs/workspace packages from the maintainer; a registry 404 is not a runtime failure. Do not mix unrelated releases. For a new project:

```sh
npm init -y
npm pkg set type=module
npm install @webpilot/capability-sdk @webpilot/capability-host
npm install -D typescript tsx @types/node
```

This example implements a new capability without inheriting a class. Implement `CapabilityProvider.manifest` and `createRuntime(context)`; expose tools with JSON Schema plus an authoritative `parse`, and return `CapabilityResult`. Use `CapabilityRegistry.register/resolve` directly for minimal assembly, or host's `mountCapabilities` for normalized configuration and Skills.

SDK includes real runtime code, not only interfaces: the registry detects duplicate capability/tool/Skill IDs, tracks active invocations and owns disposal; `createCapabilityExecutor` enforces serial groups and calls host policies. Use one executor per mounted runtime, not one per tool call. Node-only process/persistence helpers live at `/node`. SDK does not depend on AI SDK, MCP, React or application code. A new ordinary capability should follow these contracts; sensitive-data is separately documented model middleware.

## 2. Create the provider

Save as `provider.ts`. This file creates the provider and exports the first valid call, explicit configuration overrides and host cleanup.

```ts
import { createCapabilityRuntime, defineCapabilityInput, defineCapabilityTool,
  type CapabilityProvider } from '@webpilot/capability-sdk';
const provider: CapabilityProvider = {
  manifest: { schemaVersion: 1, id: 'example.greeting', name: 'Greeting', version: '1.0.0',
    skills: [{ id: 'example.greeting/usage', title: 'Greeting',
      summary: 'Greet a named person.', content: 'Call greet with a non-empty name.' }] },
  async createRuntime() {
    return createCapabilityRuntime({ tools: {
      greet: defineCapabilityTool({
        name: 'greet', description: 'Return a greeting for a named person.',
        input: defineCapabilityInput<{ name: string }>({
          type: 'object', properties: { name: { type: 'string', minLength: 1 } },
          required: ['name'], additionalProperties: false,
        }, (value) => {
          if (!value || typeof value !== 'object' || Array.isArray(value)
            || !('name' in value) || typeof value.name !== 'string' || !value.name.trim()
            || Object.keys(value).some(key => key !== 'name')) {
            throw new Error('Expected { name: non-empty string }');
          }
          return { name: value.name.trim() };
        }),
        async execute({ name }) {
          return { ok: true, summary: `Hello, ${name}!`, data: { name } };
        },
      }),
    } });
  },
};

export const providers = [provider];
export const configurations = {};
export const exampleCall = {
  "name": "greet",
  "input": {
    "name": "Ada"
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
import { ToolLoopAgent } from 'ai';
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
    providers, configurations, maxSteps: 10,
    context: { runId: randomUUID(), abortSignal: abort.signal },
    configStore: new EnvironmentCapabilityConfigStore(process.env),
    skills: { mode: 'eager' },
    adapter: { policy, async execute(call) {
      await beforeInvoke(call.resolvedTool.publicName, call.input);
      return call.invoke();
    } },
  });
  const agent = new ToolLoopAgent({ model: modelProvider.chatModel(modelId),
    ...runtime.agentOptions });
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

## Troubleshooting and completion criteria

- Module not found: check published exports, aligned versions and Node/ESM setup; install the selected entrypoint's optional peers.
- Tool missing: inspect `runtime.tools`, enabled capability IDs and allowed names; do not guess names from folder names.
- Validation failure: use the actual inputSchema and parser error, not a copied schema from a different entrypoint.
- Disabled/unavailable operation: check normalized settings, selected backend, installed binaries and supplied host callbacks.
- Skill not followed: append eager instructions before the model call, or implement the lazy reader and availability policy.
- A timeout is not proof that a side effect did not happen. Inspect stored/live state before retrying.
- Integration is complete when the first call returns `ok: true`, the Agent receives the same tool schema and full result, required artifacts/images are usable by the caller, and the owning runtime closes without leaked resources.

## Published entrypoints

- `@webpilot/capability-sdk/node`
- `@webpilot/capability-sdk`

## Concrete package providers

Replace provider.ts with the implementation from the selected package README. Keep integration.ts and its lifecycle unchanged.

- [capability-file](../capability-file/README.md)
- [capability-browser](../capability-browser/README.md)
- [capability-chart](../capability-chart/README.md)
- [capability-knowledge](../capability-knowledge/README.md)
- [capability-workflow](../capability-workflow/README.md)
- [capability-git](../capability-git/README.md)
- [capability-connectors](../capability-connectors/README.md)
- [capability-communication](../capability-communication/README.md)
- [capability-computer](../capability-computer/README.md)
- [capability-data](../capability-data/README.md)
- [capability-media](../capability-media/README.md)
- [capability-code-sandbox](../capability-code-sandbox/README.md)

## Registered output across frameworks

Tool registration and UI registration are separate. Package manifests carry pure
response definitions; they never import React or a server storage implementation.
`CapabilityRegistry.resolve()` and `mountCapabilities()` return a `responses`
registry assembled from active manifests and filtered to the enabled tool names.
Pass host-owned types such as `coreResponses` through the mount `responses` option.
Do not register the same definitions both there and in a provider manifest.

In the framework integration from step 3, add a session and wire these callbacks:

```ts
import { ResponseSession } from '@webpilot/capability-sdk';
import { coreResponses, markdownBlock } from '@webpilot/capability-response';

// Supply responses: coreResponses to mountCapabilities in step 3.
const responses = new ResponseSession(mounted.responses);
const finalInput = responses.registry.input();
const instructions = responses.registry.modelInstructions();

// After the existing validated/policy-controlled tool execution:
responses.observe(toolName, result); // complete CapabilityResult object

// Register this object using the framework's native tool constructor.
// Append instructions to the Agent instructions before the first model call.
const finalResponse = {
  name: 'finalResponse',
  description: instructions,
  inputSchema: finalInput.jsonSchema,
  execute(value: unknown) {
    const accepted = responses.accept(value); // validates, throws on bad input
    return { accepted: true, blockCount: accepted.blocks.length };
  },
};

// Stop the framework loop when responses.accepted is true, retaining its step limit.
// After the loop (and after all streamed tool results have arrived):
const output = responses.finish();
// Persist/send output.status and output.blocks via your host's message transport.
```

The variables `mounted`, `toolName`, and `result` above are the
mount and tool callback values from your framework, not SDK globals.
Create one `ResponseSession` per turn; all tool callbacks in that turn share it.
If the runtime is retained across turns, allocate a new session for the next turn.
Pass `status: 'failed'` or `'blocked'` to `finish` when the loop exits that way.
An explicitly accepted response takes precedence over fallback status/text. Every
normal final answer, including prose-only responses, requires an accepted
finalResponse call; `finish()` rejects a missing call. Keep tool choice automatic
because Thinking providers may reject required or named choices. Enforce delivery
in the host, optionally requesting a bounded correction with the same tool history.
Ordinary assistant text is progress narration.

`finish` keeps explicit block order and repeated views, appends omitted tool
resources once, and selects the latest collected block for each missing resource.
It never parses identifiers in Markdown. Tool blocks require successful standard
results, a registered schema and the matching tool owner. Decode your own wire
envelope before calling `observe`. Invalid explicit responses throw; return that
validation error to the model so it can correct the call. A host-reported failed or
blocked session may finish with zero blocks; the model schema requires 1..64 blocks.

For AI SDK, `mountAISDKCapabilities({ responses: coreResponses, ... })` performs
these tool/session bindings automatically. Use its `responseSession.finish(...)`
after generation, and preserve `agentOptions.stopWhen` (accepted response or
`maxSteps`, default 20). For an already mounted runtime, pass a fresh session to
`toAISDKToolSet(snapshot, { responseSession })`, add
`createAISDKResponseTool(responseSession)`, and connect the same stop condition.

For React, register the package's `/response` and `/response-react` exports once
in `ResponseRendererRegistry`, then render every block through `RegisteredResponse`.
For resource operations register `/response-node` handlers and supply authenticated
storage/transport via the render context. A non-React host supplies its own UI
adapter using the same `{type, params}` protocol. No per-message chart/map branch
or Markdown-ID detection is required. A text-only host can use `registry.toText`
or `ResponseHandlerRegistry.export` instead.

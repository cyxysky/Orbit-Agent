# @webpilot/capability-host

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

Mount providers with normalized configuration, tool selection and a portable Skill catalog.

This README is a complete integration entrypoint. Follow steps 1–4 for any TypeScript Agent framework, or use the AI SDK/MCP routes below. All named source files are created in **your consuming project**, not inside this package.

## 1. Install and prepare

Use Node.js >=22.16 and ESM TypeScript. These examples match the 0.1.0 workspace contracts. Install matching Capability versions from your configured npm registry. If a version is unpublished, obtain the matching release tarballs/workspace packages from the maintainer; a registry 404 is not a runtime failure. Do not mix unrelated releases. For a new project:

```sh
npm init -y
npm pkg set type=module
npm install @webpilot/capability-host @webpilot/capability-sdk
npm install -D typescript tsx @types/node
```

The greeting provider demonstrates host assembly without external services. Replace it with any concrete package factory. `mountCapabilities` registers providers, loads configuration, fills defaults and creates the tool/Skill snapshot. It neither creates an Agent nor invokes a model. SDK remains a transitive dependency unless your own code imports its types or executor.

Configuration precedence is explicit per-capability overrides > stored values > context.configuration; package defaults fill missing/invalid values. `configScope` selects user/workspace/profile storage; it is not authentication. `enabledCapabilityIds` and `allowedToolNames` filter registration. Changing saved settings does not mutate an already mounted snapshot: remount for runtime changes, and recreate the owning service/driver for startup settings.

Stores: Memory and Environment from the root; JsonFile from `/node`; TypeOrm from `/typeorm`. TypeORM requires a host-owned initialized DataSource with `typeOrmCapabilityConfigurationEntity` in its entities and an appropriate database migration or prototype schema setup. `createSplitCapabilityConfigStore({ values, secrets })` separates secret storage. Package manifests own setting definitions; the host selects storage. Skill catalogs return eager content or lazy summaries; lazy summaries alone do not create a Skill tool.

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
```ts
import { MemoryCapabilityConfigStore, mountCapabilities } from '@webpilot/capability-host';
import { providers, cleanup } from './provider.js';
const store = new MemoryCapabilityConfigStore();
const scope = { userId: 'local-user', workspaceId: 'workspace-a' };
// Use only keys declared by this manifest; values are strings.
const manifest = providers[0].manifest;
const declaredDefaults = Object.fromEntries(
  (manifest.configuration?.settings || []).map(setting => [setting.key, setting.defaultValue]));
await store.save(manifest, declaredDefaults, scope);
let runtime: Awaited<ReturnType<typeof mountCapabilities>> | undefined;
try {
  runtime = await mountCapabilities({ providers, context: { runId: 'configured-run' },
    configStore: store, configScope: scope });
  console.log(runtime.configurations);
} finally {
  try { await runtime?.dispose(); } finally { await cleanup(); }
}
```

## Troubleshooting and completion criteria

- Module not found: check published exports, aligned versions and Node/ESM setup; install the selected entrypoint's optional peers.
- Tool missing: inspect `runtime.tools`, enabled capability IDs and allowed names; do not guess names from folder names.
- Validation failure: use the actual inputSchema and parser error, not a copied schema from a different entrypoint.
- Disabled/unavailable operation: check normalized settings, selected backend, installed binaries and supplied host callbacks.
- Skill not followed: append eager instructions before the model call, or implement the lazy reader and availability policy.
- A timeout is not proof that a side effect did not happen. Inspect stored/live state before retrying.
- Integration is complete when the first call returns `ok: true`, the Agent receives the same tool schema and full result, required artifacts/images are usable by the caller, and the owning runtime closes without leaked resources.

## Published entrypoints

- `@webpilot/capability-host`
- `@webpilot/capability-host/node`
- `@webpilot/capability-host/typeorm`

## Additional package reference

The following pre-existing reference includes focused API fragments and application integration notes. The complete runnable entrypoints are the numbered tutorial above; do not concatenate unrelated snippets.

## @webpilot/capability-host

Framework-neutral mounting for Orbit Capability providers. It owns the
three pieces that every Agent host otherwise has to rebuild:

- load and normalize package-owned settings;
- resolve providers into one disposable tool snapshot;
- expose a portable Skill catalog for eager or lazy context injection.

`mountCapabilities()` is the primary entrypoint for custom TypeScript Agent
frameworks. It does not create an AI SDK or MCP object. Consumers translate the
returned `runtime.tools` to their framework's tool type and inject
`runtime.skillCatalog` into that framework's instructions or Skill mechanism.
See the [framework integration guide](../capability-sdk/FRAMEWORK_INTEGRATION.md) for the
complete mapping and execution lifecycle.

```ts
import {
  EnvironmentCapabilityConfigStore,
  mountCapabilities,
} from '@webpilot/capability-host';

const runtime = await mountCapabilities({
  providers,
  context: { runId: crypto.randomUUID() },
  configStore: new EnvironmentCapabilityConfigStore(process.env),
});

console.log(runtime.tools, runtime.skillCatalog.skills);
await runtime.dispose();
```

### Configuration storage

Capability packages export setting definitions in their manifests. The host
selects persistence and injects the resolved values when each runtime starts.

- `MemoryCapabilityConfigStore`: tests, short-lived workers and embedded hosts.
- `EnvironmentCapabilityConfigStore`: environment-driven servers.
- `JsonFileCapabilityConfigStore` from `@webpilot/capability-host/node`: CLI and
  single-process Node applications.
- `TypeOrmCapabilityConfigStore` from `@webpilot/capability-host/typeorm`:
  SQLite or PostgreSQL through the same TypeORM Repository API.

For TypeORM, add `typeOrmCapabilityConfigurationEntity` to the DataSource
`entities` list. Use `synchronize: true` during prototypes or create an ordinary
migration for the `capability_configuration` table in production.

```ts
import { DataSource } from 'typeorm';
import {
  TypeOrmCapabilityConfigStore,
  typeOrmCapabilityConfigurationEntity,
} from '@webpilot/capability-host/typeorm';

const dataSource = new DataSource(process.env.DATABASE_URL
  ? {
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [typeOrmCapabilityConfigurationEntity],
    }
  : {
      type: 'better-sqlite3',
      database: './agent.db',
      entities: [typeOrmCapabilityConfigurationEntity],
    });
await dataSource.initialize();

const configStore = new TypeOrmCapabilityConfigStore({ source: dataSource });
await configStore.save(fileCapabilityManifest, {
  OFFICE_GENERATION_MODE: 'auto',
}, { userId: 'agent-user' });
```

Secret fields are metadata on package settings. To keep them outside the main
store, combine any database/file store with a vault or keychain-backed store:

```ts
const configStore = createSplitCapabilityConfigStore({
  values: databaseStore,
  secrets: vaultStore,
});
```

Explicit `configurations[capabilityId]` passed to `mountCapabilities` override
stored values. Package defaults fill missing or invalid values during
normalization.

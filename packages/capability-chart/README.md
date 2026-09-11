# @webpilot/capability-chart

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

Create, persist and edit ECharts, Three.js and Excalidraw records; optionally render them in React.

## Excalidraw diagrams

Read `chart({action:"api",query:"excalidraw",reason:"Read diagram schema"})`,
then create with `engine:"excalidraw"` and `option:{elements,appState,files}`.
Native elements need stable IDs, type and x/y/width/height; text needs `text`,
and lines/arrows need relative `points`. The API module includes a complete example.
Read and update use the same chart store and `expectedRevision` as other engines.
Images are embedded in `files`; the complete record retains the 4 MB limit.

`ChartRenderer` loads the editor only on the client. It supports edit/save/cancel,
reload after conflicts, fullscreen, PNG/SVG and editable `.excalidraw` downloads.
Without `onSave`, edits stay on the current page until downloaded. The package owns
its editor and CSS; it makes no persistence requests and imports no host UI code.
Pass `excalidraw={{assetPath:'/chart-assets/',langCode:'en',theme:'light'}}` to
configure resources and appearance. Excalidraw's asset path is window-global;
all editors on the same page should use the same path.

For offline hosting, serve the upstream `dist/prod/fonts/` directory below
`assetPath + 'fonts/'`, or expose `readExcalidrawFont(segments)` from the Node entry.
The host must include these upstream font files in its deployment. Orbit supplies
a local font endpoint and standalone tracing. Real-time multiplayer synchronization
is not included. Excalidraw is distributed under its upstream MIT license.

This README is a complete integration entrypoint. Follow steps 1–4 for any TypeScript Agent framework, or use the AI SDK/MCP routes below. All named source files are created in **your consuming project**, not inside this package.

## 1. Install and prepare

Use Node.js >=22.16 and ESM TypeScript. These examples match the 0.1.0 workspace contracts. Install matching Capability versions from your configured npm registry. If a version is unpublished, obtain the matching release tarballs/workspace packages from the maintainer; a registry 404 is not a runtime failure. Do not mix unrelated releases. For a new project:

```sh
npm init -y
npm pkg set type=module
npm install @webpilot/capability-chart @webpilot/capability-sdk @webpilot/capability-host echarts@^6
npm install -D typescript tsx @types/node
```

Install ECharts 6 for the Node validator. The result is a chart record, not a hosted web page. Retain `chartId` and read it before update; pass the latest `revision` as `expectedRevision`. Store revisions are immutable and stale writes fail. `api` lists package-owned examples and schemas.

For a UI, install React 19 and optionally Three.js `>=0.184.0 <0.186`, then import `ChartRenderer` from `/react`. Supply the returned `ChartRecord` and `onSave(nextRecord, expectedRevision)` / `onReload()` callbacks backed by your own storage API. The renderer makes no HTTP requests itself. Three.js needs WebGL2. JSON formatter strings are templates, never JavaScript function source.

## 2. Create the provider

Save as `provider.ts`. This file creates the provider and exports the first valid call, explicit configuration overrides and host cleanup.

```ts
import { createNodeChartCapability } from '@webpilot/capability-chart/node';
 const provider = createNodeChartCapability({ directory: './agent-data/charts' });

export const providers = [provider];
export const configurations = {};
export const exampleCall = {
  "name": "chart",
  "input": {
    "action": "create",
    "reason": "Create a small example chart",
    "title": "Example",
    "renderer": "svg",
    "option": {
      "xAxis": {
        "type": "category",
        "data": [
          "A",
          "B"
        ]
      },
      "yAxis": {
        "type": "value"
      },
      "series": [
        {
          "type": "bar",
          "data": [
            3,
            5
          ]
        }
      ]
    }
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

## Troubleshooting and completion criteria

- Module not found: check published exports, aligned versions and Node/ESM setup; install the selected entrypoint's optional peers.
- Tool missing: inspect `runtime.tools`, enabled capability IDs and allowed names; do not guess names from folder names.
- Validation failure: use the actual inputSchema and parser error, not a copied schema from a different entrypoint.
- Disabled/unavailable operation: check normalized settings, selected backend, installed binaries and supplied host callbacks.
- Skill not followed: append eager instructions before the model call, or implement the lazy reader and availability policy.
- A timeout is not proof that a side effect did not happen. Inspect stored/live state before retrying.
- Integration is complete when the first call returns `ok: true`, the Agent receives the same tool schema and full result, required artifacts/images are usable by the caller, and the owning runtime closes without leaked resources.

## Published entrypoints

- `@webpilot/capability-chart`
- `@webpilot/capability-chart/core`
- `@webpilot/capability-chart/node`
- `@webpilot/capability-chart/react`
- `@webpilot/capability-chart/runtime-skill`
- `@webpilot/capability-chart/settings`
- `@webpilot/capability-chart/mcp`

## Additional package reference

The following pre-existing reference includes focused API fragments and application integration notes. The complete runnable entrypoints are the numbered tutorial above; do not concatenate unrelated snippets.

## @webpilot/capability-chart

An agent-framework-neutral ECharts and Three.js capability.

The filesystem store caches its directory index and retains the latest 20 revision files plus the immutable original. Set `retainedRevisions` on the Node factory to change this limit (1–1000). Revision publication remains atomic, and stale edits are rejected. The React renderer reuses the ECharts instance for data updates; switching renderers or rebuilding Three.js geometry recreates the surface.

- `@webpilot/capability-chart` exports the portable capability, schemas, records, and store contracts.
- `@webpilot/capability-chart/node` exports the filesystem-backed Node store.
- `@webpilot/capability-chart/react` exports the renderer and browser-side `exportChartPng(chart)` without Orbit API or session dependencies. PNG export supports ECharts (canvas/SVG and registered maps), Three.js, and Excalidraw. Hosts configure Excalidraw's asset path before exporting and can use the resulting data URL in their communication adapters.
- `@webpilot/capability-chart/mcp` exports stdio and Streamable HTTP MCP entrypoints.

```ts
import { createNodeChartCapability } from '@webpilot/capability-chart/node';

const provider = createNodeChartCapability({ directory: './artifacts/charts' });
```

Pass this provider to the framework-neutral `mountCapabilities()` entrypoint,
map the resolved `chart` tool to the consuming TypeScript Agent framework, and
inject the package Skill before chart execution. See the complete
[TypeScript Agent framework integration guide](../capability-sdk/FRAMEWORK_INTEGRATION.md).

`mountAISDKCapabilities()` remains available as the optional AI SDK convenience
path. Its returned `agentOptions` contains the chart tool and eager/lazy Skill
instructions; settings are loaded before the chart runtime is created.

The included `webpilot-chart-mcp` executable stores each MCP run below
`CAPABILITY_CHART_ARTIFACTS_DIR` (or `ARTIFACTS_DIR`).

The React renderer includes fullscreen, PNG/JSON/CSV downloads, SVG export for
SVG-rendered ECharts, and table/JSON data editing in an accessible modal. Its compact
toolbar, icons, menus, dialog, focus handling, and styles are all bundled here;
the React entry point imports no Orbit application code, Next.js, session
state, API URLs, or application CSS. It makes no HTTP requests. Supply
`onSave(nextRecord, expectedRevision)` and optionally `onReload()` to connect
persistence; without `onSave`, edits apply only to the current page. Orbit
supplies both callbacks through its session-owned GET/PATCH chart endpoint.

JSON mode loads a local CodeMirror 6 editor on demand, with a dark theme, syntax
highlighting, line numbers, folding, undo/redo, indentation and JSON diagnostics.
Its editor dependencies belong to this package; no application editor or remote
worker is required. The selected editing mode has an explicit check mark and
highlight. Confirm is always visible: unchanged data closes the dialog, while
modified data is validated and saved through `onSave`.

Other React applications can pass their own `ChartRecord` and persistence callbacks:

```tsx
import { ChartRenderer } from '@webpilot/capability-chart/react';

<ChartRenderer
  chart={record}
  onSave={(next, expectedRevision) => myChartStore.save(next, expectedRevision)}
  onReload={() => myChartStore.read(record.chartId)}
/>
```

ECharts, React and Three.js are peer libraries; the capability tool contract uses
the framework-neutral capability SDK. Neither requires the Orbit application.

`chart` supports `api`, `create`, `read`, and `update`. Read before updating and
pass the returned `revision` as `expectedRevision`. The Node store preserves the
original JSON and atomically publishes immutable revision files, rejecting stale
writes. Existing version-2 chart files remain readable and editable.

ECharts formatters accept JSON string templates, such as `{b}: {c}`, rather than
strings containing JavaScript functions. Create/update validates these fields and
reports the offending path. When reading or rendering older records, function-source
formatters are omitted in memory so ECharts uses its default formatting; the original
artifact is preserved and no callback source is executed. Ordinary templates remain
unchanged. For waterfall charts, set `tooltip: { show: false }` on spacer series.

Set `engine: 'three'` to create native `bar3D`, `scatter3D`, `line3D`, or `surface3D`
charts. Points use `[x, y, z]` with z as height; surfaces additionally require a
row-major `grid: { rows, columns }`. Read `chart({ action: 'api', query: 'three',
reason: 'Read 3D schema' })` for the full schema. The optional Three.js peer is
required by React consumers; it loads only when displaying 3D. WebGL2 is required.
Simple ECharts bar/line/scatter options also offer a non-persistent 3D preview.


## Registered response integration

This package exports `/response` (types and parameter schemas), `/response-react` (component registrations), and `/response-node` (resource/export handlers). See [the response integration guide](../capability-response/README.md). Register these at host assembly; copy successful tool result `content[].block` into the structured reply.

# @webpilot/capability-browser

The persistent browserCode Node kernel uses one memory policy for recycling and
the child V8 limit. `maxHeapBytes` / `AI_BROWSER_CODE_KERNEL_MAX_HEAP_MB` sets the
between-cell recycle threshold (default 256 MiB); the old-space limit is twice
that threshold, with a 256 MiB minimum (default 512 MiB). RSS recycling defaults to
the hard heap limit plus 256 MiB and can be set with `maxRssBytes` /
`AI_BROWSER_CODE_KERNEL_MAX_RSS_MB`. Recycling happens after a cell returns, so
temporary allocations have headroom. It discards kernel variables, not browser
pages. An in-cell OOM reports `kernelReset.reason=out-of-memory`; the browser tool
classifies it as `browser-kernel-out-of-memory`. An interrupted running action keeps
`outcome=unknown`, `requiresStateRefresh=true`, and `safeToRetry=false`, including
when a click already completed. Read state before deciding whether any action is
still needed; never replay the failed cell automatically.

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

Control a Playwright browser with a persistent JavaScript environment and page observations.

`BrowserSession.executeBrowserCode()` returns `{ ok, summary, data, ... }`: `data.result` is the cell output, `data.executionState` describes failed or interrupted execution, and `data.domChanges` contains incremental page changes only when `needChange: true` is supplied. `needChange` defaults to false, skipping the delta read and output; it applies to the current cell, not previous cells. Read these objects directly; the complete payload appears only in `data`. For results returned by `createNodeBrowserCapability`, first unwrap the Capability envelope with `browserOperationFromCapabilityResult` from `@webpilot/capability-browser`. Use `summary` for status text.

This README is a complete integration entrypoint. Follow steps 1–4 for any TypeScript Agent framework, or use the AI SDK/MCP routes below. All named source files are created in **your consuming project**, not inside this package.

## 1. Install and prepare

Use Node.js >=22.16 and ESM TypeScript. These examples match the 0.1.0 workspace contracts. Install matching Capability versions from your configured npm registry. If a version is unpublished, obtain the matching release tarballs/workspace packages from the maintainer; a registry 404 is not a runtime failure. Do not mix unrelated releases. For a new project:

```sh
npm init -y
npm pkg set type=module
npm install @webpilot/capability-browser @webpilot/capability-sdk @webpilot/capability-host playwright@^1.60.0
npm install -D typescript tsx @types/node
```

Install the matching Playwright Chromium runtime with `npx playwright install chromium` in the consuming project. Create a fresh BrowserSession per mounted runtime; keep that runtime alive for the whole conversation that needs its tabs and JavaScript bindings. Use `headless: false` for visible local interaction.

`state` observes; `code` runs browser code using the package Skill APIs (`browser`, `page`, `nodeRepl`); `waitForHumanVerification` yields for a human. A normal Playwright page object is not interchangeable with every package facade. Read the runtime Skill before generating code. On timeout/abort, inspect live state before repeating actions. Screenshots require a model image-content adapter and artifact storage; browser downloads can use File's `createNodeFileDownloadReceiver`.

The dedicated `/mcp` entrypoint uses `browser.open`, `browser.code`, `browser.snapshot`, `browser.close` with an explicit `browserSessionId`. The generic provider in this tutorial exposes a single `browser` tool. Do not mix the two schemas. For remote multi-call sessions use the stateful HTTP example in MCP.md, or stdio; the convenience request-scoped HTTP handler does not preserve this in-memory session manager between requests.

## 2. Create the provider

Save as `provider.ts`. This file creates the provider and exports the first valid call, explicit configuration overrides and host cleanup.

```ts
import { BrowserSession, createNodeBrowserCapability } from '@webpilot/capability-browser/node';
 const provider = createNodeBrowserCapability({
   createOptions: (context) => {
     const session = new BrowserSession({ headless: true, isolated: true });
     return { session, runId: context.runId,
       ensureStarted: () => session.start(), disposeSession: true,
       imageInputAvailable: false };
   },
 });

export const providers = [provider];
export const configurations = {};
export const exampleCall = {
  "name": "browser",
  "input": {
    "action": "state",
    "reason": "Inspect the initial browser state"
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
| `BROWSER_PREVIEW_FPS` | `20` | `runtime` |
| `BROWSER_OUTPUT_PIXEL_RATIO` | `1.5` | `runtime` |
| `BROWSER_SCREENCAST_FORMAT` | `jpeg` | `runtime` |
| `BROWSER_SCREENCAST_QUALITY` | `90` | `runtime` |
| `BROWSER_PREVIEW_TRANSPORT` | `video` | `runtime` |
| `BROWSER_PREVIEW_VIDEO_BITRATE_KBPS` | `` | `runtime` |
| `BROWSER_PREVIEW_VIDEO_SOURCE_FORMAT` | `jpeg` | `runtime` |
| `BROWSER_PREVIEW_VIDEO_MAX_WIDTH` | `1920` | `runtime` |
| `BROWSER_PREVIEW_VIDEO_MAX_HEIGHT` | `1080` | `runtime` |
| `BROWSER_PREVIEW_VIDEO_KEYFRAME_INTERVAL` | `15` | `runtime` |
| `BROWSER_PROFILE_CLEAR_CACHE_ON_CLOSE` | `true` | `startup` |
| `BROWSER_USER_BROWSER_IDLE_TIMEOUT_MS` | `180000` | `runtime` |
| `ELECTRON_EMBEDDED_BROWSER` | `false` | `startup` |
| `HEADLESS_BROWSER` | `false` | `startup` |
| `BROWSER_VIEWPORT_MODE` | `auto` | `startup` |
| `BROWSER_VIEWPORT_WIDTH` | `` | `startup` |
| `BROWSER_VIEWPORT_HEIGHT` | `` | `startup` |
| `BROWSER_NAVIGATION_DOM_QUIET_MS` | `250` | `runtime` |
| `BROWSER_NAVIGATION_DOM_STABILITY_TIMEOUT_MS` | `1000` | `runtime` |
| `BROWSER_IGNORE_HTTPS_ERRORS` | `false` | `startup` |
| `BROWSER_HTTP_REQUEST_HISTORY_LIMIT` | `400` | `runtime` |
| `AI_HTTP_REQUEST_TOOL_LIMIT` | `80` | `runtime` |
| `SCREENSHOT_TIMEOUT_MS` | `15000` | `runtime` |
| `MANUAL_VERIFICATION_TIMEOUT_MS` | `180000` | `runtime` |
| `BROWSER_CHAT_KEEP_BROWSER_OPEN_AFTER_TURN` | `true` | `runtime` |
| `BROWSER_CHAT_ACTION_FRAME_LIMIT` | `24` | `runtime` |
| `BROWSER_CHAT_SHOW_REASONING` | `false` | `runtime` |
| `BROWSER_CHAT_LOG_LIMIT` | `2000` | `runtime` |
| `AI_VISUAL_HISTORY_LIMIT` | `6` | `runtime` |
| `AI_COMPLETION_VERIFY` | `true` | `runtime` |
| `PLAYWRIGHT_TRACE` | `true` | `startup` |

## Troubleshooting and completion criteria

- Module not found: check published exports, aligned versions and Node/ESM setup; install the selected entrypoint's optional peers.
- Tool missing: inspect `runtime.tools`, enabled capability IDs and allowed names; do not guess names from folder names.
- Validation failure: use the actual inputSchema and parser error, not a copied schema from a different entrypoint.
- Disabled/unavailable operation: check normalized settings, selected backend, installed binaries and supplied host callbacks.
- Skill not followed: append eager instructions before the model call, or implement the lazy reader and availability policy.
- A timeout is not proof that a side effect did not happen. Inspect stored/live state before retrying.
- Integration is complete when the first call returns `ok: true`, the Agent receives the same tool schema and full result, required artifacts/images are usable by the caller, and the owning runtime closes without leaked resources.

## Published entrypoints

- `@webpilot/capability-browser`
- `@webpilot/capability-browser/node`
- `@webpilot/capability-browser/runtime-skill`
- `@webpilot/capability-browser/settings`
- `@webpilot/capability-browser/session-group`
- `@webpilot/capability-browser/mcp`

## Additional package reference

The following pre-existing reference includes focused API fragments and application integration notes. The complete runnable entrypoints are the numbered tutorial above; do not concatenate unrelated snippets.

## @webpilot/capability-browser

An agent-framework-neutral Playwright browser capability.

The root export owns one `browser` capability contract with `state`, `code`, and
`waitForHumanVerification` actions. `./node` owns BrowserSession,
the persistent JavaScript kernel, AX/DOM snapshots, tab lifecycle, screenshots,
preview state, and runtime discovery.

Applications inject artifact storage and optional persistent `agent.state`
services through `BrowserSessionOptions.host`. Browser Chat, databases, defect
reporting, model selection, and the Agent loop remain host responsibilities.

The optional `system-browser-interactive-qa` Skill is included in the capability
manifest. The main runtime Skill routes UI-debugging and acceptance tasks to it
through the host's existing Skill reader. It covers persistent-session iteration,
functional postconditions, visual review and viewport evidence using the existing
browser APIs. This optional Skill is separate from the main browser runtime instructions.

Session operations serialize preparation, execution and result collection together,
including live input and tab switching. Independent sessions can still run concurrently.
Closing a session cancels queued work and drains active cleanup before releasing it.

`state` / `browser.snapshot` accept `scope: 'active' | 'all'`, an exact `frame`
path (`main` for the main frame), a unique `selector`, literal `query`, and
`maxOutputChars`. Pass a returned `nextCursor` as `cursor` to continue the same
immutable capture. Keep the selection unchanged; cursors expire after two minutes,
navigation, a new capture, or a code action. `capturedAt` describes historical
capture time, so re-check live locators before acting on a continuation page.

Failed code results include `executionState`: attempted actions, completed Playwright calls,
execution phase, outcome and `requiresStateRefresh`. A timeout/abort/crash has an
unknown outcome once execution started; read live state before retrying. A completed
Playwright call alone is not proof that the application's business operation succeeded.
`kernelReset.reason` also covers timeout, abort and crash; JavaScript bindings are lost.

Hosts can set `host.receiveDownload` to persist actual browser download bytes,
including authenticated, POST-generated and blob downloads. The File package exports
`createNodeFileDownloadReceiver({ artifactsRoot, artifactUrl })` for this contract.
Code results expose `downloads` with artifact IDs usable by File `readContent`.
Without this adapter, the existing live-preview URL relay remains available.

The session facade delegates shared browser leases, scheduling, state pagination and
download lifecycle to separate internal modules; existing public imports are preserved.

```ts
import { BrowserSession, createNodeBrowserCapability } from '@webpilot/capability-browser/node';

const session = new BrowserSession({ headless: true, isolated: true });
const provider = createNodeBrowserCapability({
  createOptions: (context) => ({
    session,
    runId: context.runId,
    ensureStarted: () => session.start(),
    disposeSession: true,
  }),
});
```

Pass this provider to the framework-neutral `mountCapabilities()` entrypoint,
map the resolved `browser` tool to the consuming TypeScript Agent framework,
and inject the package Skill before Browser execution. See the complete
[TypeScript Agent framework integration guide](../capability-sdk/FRAMEWORK_INTEGRATION.md).

`mountAISDKCapabilities()` is the optional AI SDK convenience path. Its returned
`agentOptions` contains both tools and eager/lazy Skill instructions; settings
are loaded from the selected host configuration store before Browser runtime
creation.

`@webpilot/capability-browser/mcp` exposes explicit sessions. Call
`browser.open` to obtain a `browserSessionId`, then pass it to
`browser.code`, `browser.snapshot`, and `browser.close`. The included
`webpilot-browser-mcp` executable serves this interface over stdio.

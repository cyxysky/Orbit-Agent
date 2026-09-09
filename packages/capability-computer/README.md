# @webpilot/capability-computer

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

Observe and operate an interactive desktop through a local or remote driver.

This README is a complete integration entrypoint. Follow steps 1–4 for any TypeScript Agent framework, or use the AI SDK/MCP routes below. All named source files are created in **your consuming project**, not inside this package.

## 1. Install and prepare

Use Node.js >=22.16 and ESM TypeScript. These examples match the 0.1.0 workspace contracts. Install matching Capability versions from your configured npm registry. If a version is unpublished, obtain the matching release tarballs/workspace packages from the maintainer; a registry 404 is not a runtime failure. Do not mix unrelated releases. For a new project:

```sh
npm init -y
npm pkg set type=module
npm install @webpilot/capability-computer @webpilot/capability-sdk @webpilot/capability-host
npm install -D typescript tsx @types/node
```

The built-in driver requires an unlocked interactive Windows user session, not Session 0. Enabling `AGENT_COMPUTER_ENABLED` starts it lazily. Other systems need `AGENT_COMPUTER_ENDPOINT` or a custom `createDriver`; an endpoint is a driver HTTP API, not an RDP/VNC address. `HEAD` checks health and `POST` receives an action JSON object. Optional `AGENT_COMPUTER_AUTHORIZATION` is passed as the Authorization header.

Observe first. Use current `elementId` values for clicks or exact pixels in the returned screenshot dimensions; IDs expire after actions. Actions are `observe`, `launch`, `click`, `type`, `key`, `scroll`, `wait`. `observe` already captures a screenshot. The generic text-only sample preserves the result structure but does not make images visible to a model: add a native image adapter resolving the saved image from trusted storage. For MCP use `resolveImage`; the adapter never fetches arbitrary artifact URLs itself.

## 2. Create the provider

Save as `provider.ts`. This file creates the provider and exports the first valid call, explicit configuration overrides and host cleanup.

```ts
import { createNodeComputerCapability } from '@webpilot/capability-computer/node';
 const provider = createNodeComputerCapability({ screenshotDirectory: './agent-data/screenshots' });

export const providers = [provider];
export const configurations = {
  "com.webpilot.computer": {
    "AGENT_COMPUTER_ENABLED": "true"
  }
};
export const exampleCall = {
  "name": "computer",
  "input": {
    "action": "observe",
    "reason": "Observe the desktop before interacting"
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
| `AGENT_COMPUTER_ENABLED` | `false` | `runtime` |
| `AGENT_COMPUTER_TIMEOUT_MS` | `30000` | `runtime` |
| `AGENT_COMPUTER_ENDPOINT` | `` | `startup` |
| `AGENT_COMPUTER_AUTHORIZATION` | `` | `startup` |

## Troubleshooting and completion criteria

- Module not found: check published exports, aligned versions and Node/ESM setup; install the selected entrypoint's optional peers.
- Tool missing: inspect `runtime.tools`, enabled capability IDs and allowed names; do not guess names from folder names.
- Validation failure: use the actual inputSchema and parser error, not a copied schema from a different entrypoint.
- Disabled/unavailable operation: check normalized settings, selected backend, installed binaries and supplied host callbacks.
- Skill not followed: append eager instructions before the model call, or implement the lazy reader and availability policy.
- A timeout is not proof that a side effect did not happen. Inspect stored/live state before retrying.
- Integration is complete when the first call returns `ok: true`, the Agent receives the same tool schema and full result, required artifacts/images are usable by the caller, and the owning runtime closes without leaked resources.

## Published entrypoints

- `@webpilot/capability-computer`
- `@webpilot/capability-computer/node`
- `@webpilot/capability-computer/mcp`
- `@webpilot/capability-computer/runtime-skill`
- `@webpilot/capability-computer/settings`

## Additional package reference

The following pre-existing reference includes focused API fragments and application integration notes. The complete runnable entrypoints are the numbered tutorial above; do not concatenate unrelated snippets.

## @webpilot/capability-computer

Desktop observation and input contracts for agents. On Windows, enabling the
capability is enough: the Node adapter lazily starts a loopback-only driver,
creates an in-memory Bearer credential, and reuses that driver for the process.
No endpoint or token setup is required.

The built-in driver runs in the current interactive Windows user session and
supports screenshots, mouse input, keyboard chords, Unicode text input,
scrolling, and waits without third-party runtime dependencies. Locked desktops
and Windows Session 0 services cannot provide interactive computer control.

```ts
import { createNodeComputerCapability } from '@webpilot/capability-computer/node';

const computer = createNodeComputerCapability();
```

Pass this provider to `mountCapabilities()`, map the resolved `computer` tool to
the native tool type of the consuming TypeScript Agent framework, and inject the
package Skill before the first desktop action. The host remains responsible for
approval of input actions and for forwarding image content to models that
support it. See the complete
[TypeScript Agent framework integration guide](../capability-sdk/FRAMEWORK_INTEGRATION.md).

Set `AGENT_COMPUTER_ENABLED=true`, or enable **Computer control** in the host's
settings. A host may pass `screenshotDirectory` when screenshots should be
published from an application-owned artifact directory; otherwise the package
uses an isolated temporary directory.

The model-facing `computer` tool returns the exact saved screenshot width and
height. Click coordinates are direct pixels in that latest screenshot: `(0, 0)`
is the top-left pixel and `(width - 1, height - 1)` is the bottom-right pixel.
No normalized-coordinate conversion is performed before calling the driver.
The tool rejects coordinates outside the latest screenshot bounds.

On Windows, observations also discover foreground-window elements. Native UI
Automation is preferred, with Windows desktop icons discovered through their
legacy accessibility objects. When an application exposes no actionable
controls, the built-in driver falls back to Windows OCR and generic
visual-region detection. Each element includes a current-screenshot `bounds`, `center`, and
ephemeral `elementId`. Pass that id to `action: "click"` instead of estimating
coordinates. The capability resolves the id to physical pixels and invalidates
the element map after the action.

For named desktop or Start-menu applications, use `action: "launch"` with the
visible shortcut name. This avoids locating an application icon by image
coordinates when Windows already provides a stable application identity.

### Remote driver protocol

`AGENT_COMPUTER_ENDPOINT` is an optional advanced override for deployments that
provide a different desktop host. It is not an RDP/VNC URL and is not the URL
that the agent should browse. The adapter sends one action per request:

- `HEAD <endpoint>` is the health check and must return a 2xx response.
- `POST <endpoint>` receives JSON and must return a JSON object.
- `AGENT_COMPUTER_AUTHORIZATION`, when set, is forwarded verbatim as the
  `Authorization` header. A typical value is `Bearer <token>`.

Example request:

```json
{
  "action": "click",
  "reason": "Activate the control visible in the latest observation",
  "x": 120,
  "y": 240,
  "button": "left",
  "clickCount": 1,
  "timeoutMs": 30000
}
```

Element-based click request:

```json
{
  "action": "click",
  "reason": "Activate the exact Login element returned by the latest observation",
  "elementId": "visual:1788494725746:0",
  "button": "left",
  "clickCount": 1
}
```

The HTTP driver boundary receives the same screenshot pixel coordinates supplied
by the model. The Node adapter derives observation width and height from the
persisted PNG or JPEG bytes so the returned dimensions describe the actual
image, even if a remote driver supplied stale metadata.

`observe` already captures and attaches one fresh screenshot; there is no
separate duplicate screenshot action. Supported actions are `observe`,
`launch`, `click`, `type`, `key`,
`scroll`, and `wait`. An observation response can include `displayId`, `width`,
`height`, `activeWindow`, `elements`, `sequence`, and a published screenshot's
`artifactId` and `mediaType`. A remote driver can instead return
`screenshotBase64` with `mediaType`; the Node capability validates and writes
the image into its configured screenshot directory before publishing it as
capability image content.

External endpoint and authorization overrides are startup settings. The
automatically managed built-in endpoint and credential are never exposed as
user settings.

# @webpilot/capability-communication

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

Create message drafts and send them through configured channels with delivery receipts.

This README is a complete integration entrypoint. Follow steps 1–4 for any TypeScript Agent framework, or use the AI SDK/MCP routes below. All named source files are created in **your consuming project**, not inside this package.

## 1. Install and prepare

Use Node.js >=22.16 and ESM TypeScript. These examples match the 0.1.0 workspace contracts. Install matching Capability versions from your configured npm registry. If a version is unpublished, obtain the matching release tarballs/workspace packages from the maintainer; a registry 404 is not a runtime failure. Do not mix unrelated releases. For a new project:

```sh
npm init -y
npm pkg set type=module
npm install @webpilot/capability-communication @webpilot/capability-sdk @webpilot/capability-host
npm install -D typescript tsx @types/node
```

The example only lists channels. The webhook must accept `{ targets, content, metadata }`; an arbitrary provider webhook may need `mapBody` and `verifyResponse` or a custom `CommunicationChannel`. `draft` takes `channelId`, `targets` and `content`; `readDraft` and `send` use the returned `draftId`. Draft creation does not send.

Set `AGENT_COMMUNICATION_ALLOW_SEND=true` only in a host that authorizes the exact stored draft before `send` (use `beforeInvoke`, or the AI SDK execute wrapper). The permission callback cannot inspect tool input on its own. The persistent SQLite draft store claims delivery atomically; reuse an existing draft after a confirmed non-delivery. Verify uncertain `sending`/`unknown` results before retrying; `sent` returns its recorded receipt.

Text uses `{ format: "text", body: "..." }`. Media uses one of `artifactId` or provider-issued `mediaId`; the host implements ownership checks and upload. WebSocket and MCP IDs are protocol-specific. Node also exports connector-backed channels and WeCom bot connections; custom drivers implement the exported channel contract. Credentials never belong in model-generated arguments.

## 2. Create the provider

Save as `provider.ts`. This file creates the provider and exports the first valid call, explicit configuration overrides and host cleanup.

```ts
import { createJsonWebhookChannel, createNodeCommunicationCapability } from '@webpilot/capability-communication/node';
 const url = process.env.NOTIFICATION_WEBHOOK_URL;
 if (!url) throw new Error('Set NOTIFICATION_WEBHOOK_URL to your canonical webhook');
 const provider = createNodeCommunicationCapability({
   draftDirectory: './agent-data/communication',
   channels: () => [createJsonWebhookChannel({ id: 'notifications', url })],
 });

export const providers = [provider];
export const configurations = {};
export const exampleCall = {
  "name": "communication",
  "input": {
    "action": "channels",
    "reason": "Inspect configured delivery channels"
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
| `AGENT_COMMUNICATION_ALLOW_SEND` | `false` | `runtime` |
| `AGENT_COMMUNICATION_TIMEOUT_MS` | `30000` | `runtime` |

## Troubleshooting and completion criteria

- Module not found: check published exports, aligned versions and Node/ESM setup; install the selected entrypoint's optional peers.
- Tool missing: inspect `runtime.tools`, enabled capability IDs and allowed names; do not guess names from folder names.
- Validation failure: use the actual inputSchema and parser error, not a copied schema from a different entrypoint.
- Disabled/unavailable operation: check normalized settings, selected backend, installed binaries and supplied host callbacks.
- Skill not followed: append eager instructions before the model call, or implement the lazy reader and availability policy.
- A timeout is not proof that a side effect did not happen. Inspect stored/live state before retrying.
- Integration is complete when the first call returns `ok: true`, the Agent receives the same tool schema and full result, required artifacts/images are usable by the caller, and the owning runtime closes without leaked resources.

## Published entrypoints

- `@webpilot/capability-communication`
- `@webpilot/capability-communication/node`
- `@webpilot/capability-communication/mcp`
- `@webpilot/capability-communication/runtime-skill`
- `@webpilot/capability-communication/settings`

## Additional package reference

The following pre-existing reference includes focused API fragments and application integration notes. The complete runnable entrypoints are the numbered tutorial above; do not concatenate unrelated snippets.

## @webpilot/capability-communication

Draft-first outbound messaging for agents. The core uses provider-neutral targets,
content, channel capabilities, and delivery receipts. Each channel driver owns its
protocol, authentication, message mapping, response validation, and lifecycle;
credentials remain host-managed.

The Node adapter includes:

- a canonical HTTP webhook channel for services that accept Orbit's standard
  `{ targets, content, metadata }` envelope;
- a provider-neutral connector-operation channel for turning an MCP or other
  connector operation into an outbound channel;
- Enterprise WeChat persistent bot connections backed by the official
  `@wecom/aibot-node-sdk`, including receiving messages, media uploads and replies.
  Bot-configured outbound drafts use this same WebSocket connection for both
  upload and send. MCP-only channels accept media IDs from their own protocol.

Email, DingTalk, Feishu, Slack, and other providers can implement the same
`CommunicationChannel` interface without changing the core communication tool.

Drivers report confirmed non-delivery with
`CommunicationDeliveryError(message, 'not-sent')` from the core package. This
persists `delivery.status: 'failed'` and permits retrying the same draft after
the cause is corrected. Timeouts, missing receipts, and partial deliveries stay
`unknown`; they must be verified before retrying. A `sent` draft returns its
stored receipt without sending again. Never classify failures by matching
provider error text in the core tool.

### TypeScript Agent framework integration

```ts
import {
  createConnectorCommunicationChannel,
  createJsonWebhookChannel,
  createNodeCommunicationCapability,
  createWeComMessageArguments,
  validateWeComMessageContent,
} from '@webpilot/capability-communication/node';
import { createMcpStreamableHttpConnector } from '@webpilot/capability-connectors/node';

const wecomConnector = createMcpStreamableHttpConnector({
  id: 'wecom-message-mcp',
  url: process.env.WECOM_MESSAGE_MCP_URL!,
});

const provider = createNodeCommunicationCapability({
  channels: [
    createJsonWebhookChannel({
      id: 'notifications',
      url: process.env.NOTIFICATION_WEBHOOK_URL!,
    }),
    createConnectorCommunicationChannel({
      id: 'wecom',
      driverId: 'wecom-aibot-mcp',
      connector: wecomConnector,
      operationId: 'message_aibot_send',
      capabilities: {
        targetKinds: ['user', 'group'],
        contentFormats: ['text', 'markdown', 'image', 'file', 'voice', 'video'],
        mediaSources: ['mediaId'],
      },
      validateContent: validateWeComMessageContent,
      defaultTargets: [{ kind: 'user', id: process.env.WECOM_DEFAULT_CHAT_ID! }],
      mapArguments: (draft, target, context) => createWeComMessageArguments({ content: draft.content, target, context }),
    }),
  ],
  draftDirectory: './agent-data/communication',
});
```

Register this provider with `mountCapabilities()` and expose the resolved
`communication` tool through the consuming TypeScript Agent framework. The host
must keep credentials outside model input and approve `send` separately from
draft creation. See the complete
[TypeScript Agent framework integration guide](../capability-sdk/FRAMEWORK_INTEGRATION.md).

### Media delivery

Media drafts use `{ format: 'image' | 'file' | 'voice' | 'video', artifactId }`
or an existing provider-issued `mediaId`, with exactly one source. Video messages
may include `title` and `description`. Send text captions as a separate draft.
WeCom maps each format to the matching `msg_type` and nested `{ media_id }` object;
Markdown image syntax is rejected because WeCom does not render it.

To enable artifact delivery, pass `media: { readArtifact, upload }` to
`createWeComMessageArguments` and advertise `mediaSources: ['artifactId', 'mediaId']`.
The host must enforce artifact ownership. Reading and uploading happen inside
the approved send operation, never while drafting. Voice artifacts must be AMR;
other audio formats can be sent as files.

`createWeComBotConnection({ botId, secret })` maintains the official bot connection.
Its `upload` implementation sends init/chunk/finish frames through the SDK, with
a 50 MB limit. No separate HTTP upload endpoint is needed. Reuse one connection
per bot for message ingestion and uploads; disconnect it when the channel is disabled.
`onMessage` exposes normalized text/voice-transcription, mixed text/images,
image/file/video media descriptors and authenticated single/group targets.
`download` uses the official SDK to download and decrypt each descriptor using
its own AES key. Replies to those callbacks use that connection's `sendText`
and `sendMedia`, rather than passing WebSocket IDs into the MCP's encrypted-ID API.

The Orbit host persists a current session for each bot and WeCom conversation.
Incoming text starts or continues the existing Browser Chat Agent
under the channel owner's account in full mode, without per-tool confirmation.
Group callback text has its leading routing mention removed before command
parsing and Agent submission; single-chat text and mentions within the body remain intact.
`/start` creates and selects a new session;
`/delete` deletes the selected session; `/list` lists all sessions belonging to
the channel's web account, including sessions created in the web UI;
`/select chat_xxx` selects any session owned by that account. Group chat members
share the selected context. Sessions owned by other web accounts remain inaccessible.

WebSocket and MCP targets and media IDs belong to different protocol contexts.
Never upload with WebSocket and send that ID through MCP. Channel settings always
fetch the latest conversations from `message_aibot_sessions_list` (up to 20) and
verify the selected recipient through the same MCP before saving it.
The communication tool exposes remote targets with `transport: 'wecom-mcp'` and
locally received attachment-capable targets with `transport: 'wecom-websocket'`.
Copy the target's transport and ID into the draft. Settings defaults use MCP;
artifact uploads require an explicitly selected WebSocket target. Callback
replies continue to use the originating WebSocket conversation.
Treat provider media IDs as opaque values, without hex/base64 shape assumptions.

Inbound message IDs are deduplicated durably, replies record per-part delivery
state, and uncertain deliveries are not blindly retried. Queued work reloads the
inbound record after entering its conversation queue, so a polling snapshot taken
during upload or send cannot replay a completed reply or overwrite its receipt.
Completed output can
be delivered after restart; interrupted tool execution is not repeated automatically.
Bot-created sessions and turns submitted from the bot explicitly use full mode.
Final text and output media are returned to the
originating conversation automatically. Mixed text/images enter one Agent turn.
Attachment-only messages are downloaded into account-owned uploads and persisted
as waiting inputs; the next text from the same sender in the same web session
uses them together. This supports files followed by a separate instruction,
including multiple files and delayed text, without a debounce timer. Session
switches do not move waiting attachments; deleting a session cancels them.
Pending inputs share web upload size, quota and retention rules. The Agent
receives normal browser-chat attachments and can reuse them in later turns.

The Node draft store uses SQLite transactions to claim delivery across local processes. A sent draft returns its original receipt when called again. Confirmed non-deliveries become `failed` and can be retried; ambiguous or interrupted sends remain `unknown` (or `sending` after a crash). Verify the remote receipt before replacing an uncertain delivery. The draft id is passed as an idempotency key to channel context metadata and JSON webhooks. Custom stores must implement atomic `claimDelivery` and `finishDelivery` to send. Call `dispose()` when directly managing a store.

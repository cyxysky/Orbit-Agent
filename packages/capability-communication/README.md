# @webpilot/capability-communication

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

## TypeScript Agent framework integration

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

## Media delivery

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

# @webpilot/capability-media

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

Inspect media, extract frames, and connect host-selected OCR, transcription and generation engines.

This README is a complete integration entrypoint. Follow steps 1–4 for any TypeScript Agent framework, or use the AI SDK/MCP routes below. All named source files are created in **your consuming project**, not inside this package.

`mediaConfigurationForProviders` includes Codex CLI as the default image model, independent of language providers. It reuses local Codex login without API keys, URLs, or model configuration; explicit media selections take precedence. Install `ai-sdk-provider-codex-cli` and a Codex CLI with native image generation. The adapter discovers the CLI default model, supports reference-image edits, and saves outputs through the normal artifact publisher. Masks are unsupported. CLI/account availability and generation errors are returned directly; no automatic provider fallback occurs.

## 1. Install and prepare

Use Node.js >=22.16 and ESM TypeScript. These examples match the 0.1.0 workspace contracts. Install matching Capability versions from your configured npm registry. If a version is unpublished, obtain the matching release tarballs/workspace packages from the maintainer; a registry 404 is not a runtime failure. Do not mix unrelated releases. For a new project:

```sh
npm init -y
npm pkg set type=module
npm install @webpilot/capability-media @webpilot/capability-sdk @webpilot/capability-host
npm install -D typescript tsx @types/node
```

Install FFmpeg/ffprobe and set `MEDIA_SOURCE_PATH`. This complete example implements inspection and JPEG frame extraction. The host maps opaque `sourceRef` values to allowed files and copies frames to durable storage before the temporary extraction directory disappears. Replace local file URLs with your authenticated artifact publishing service for remote use.

OCR/transcription require explicit `ocr`/`transcribe` implementations; they are not supplied by FFmpeg. Generation uses `/ai-sdk`'s `createAiSdkMediaGenerationOperations({ configuration, readSource, publishArtifact })`, composed with the inspection operations. Install AI SDK and the chosen provider packages when using that entrypoint. Configure drivers/models with `/models` and `/model-settings`; use `listModels` and a returned configuration ID as `modelRef`. No generation model is selected by this example.

Image/video/speech generation returns artifact metadata, not raw Base64. Generation does not require FFmpeg. Video polling and total timeouts are bounded; avoid repeating paid generation automatically after an uncertain cancellation. Preserve `url` for inline display and `downloadUrl` for downloads.

## 2. Create the provider

Save as `provider.ts`. This file creates the provider and exports the first valid call, explicit configuration overrides and host cleanup.

```ts
import { copyFile, mkdir } from 'node:fs/promises';
 import { randomUUID } from 'node:crypto';
 import path from 'node:path';
 import { pathToFileURL } from 'node:url';
 import { createMediaCapability } from '@webpilot/capability-media';
 import { createFfmpegMediaOperations } from '@webpilot/capability-media/node';
 const sourcePath = process.env.MEDIA_SOURCE_PATH;
 if (!sourcePath) throw new Error('Set MEDIA_SOURCE_PATH to a local media file');
 const sources = new Map([['sample', path.resolve(sourcePath)]]);
 const provider = createMediaCapability({ createOperations: () => createFfmpegMediaOperations({
   ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
   ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
   async resolveSource(sourceRef) {
     const source = sources.get(sourceRef);
     if (!source) throw new Error('Unknown sourceRef');
     return source;
   },
   async publishArtifact(filePath) {
     const directory = path.resolve('./agent-data/media');
     await mkdir(directory, { recursive: true });
     const fileName = randomUUID() + path.extname(filePath);
     const target = path.join(directory, fileName);
     await copyFile(filePath, target);
     return { artifactId: fileName, fileName, mediaType: 'image/jpeg',
       url: pathToFileURL(target).href, downloadUrl: pathToFileURL(target).href };
   },
 }) });

export const providers = [provider];
export const configurations = {};
export const exampleCall = {
  "name": "media",
  "input": {
    "action": "inspect",
    "reason": "Inspect registered media",
    "sourceRef": "sample"
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
| `AGENT_MEDIA_TIMEOUT_MS` | `120000` | `runtime` |
| `AGENT_MEDIA_MAX_FRAMES` | `12` | `runtime` |

## Troubleshooting and completion criteria

- Module not found: check published exports, aligned versions and Node/ESM setup; install the selected entrypoint's optional peers.
- Tool missing: inspect `runtime.tools`, enabled capability IDs and allowed names; do not guess names from folder names.
- Validation failure: use the actual inputSchema and parser error, not a copied schema from a different entrypoint.
- Disabled/unavailable operation: check normalized settings, selected backend, installed binaries and supplied host callbacks.
- Skill not followed: append eager instructions before the model call, or implement the lazy reader and availability policy.
- A timeout is not proof that a side effect did not happen. Inspect stored/live state before retrying.
- Integration is complete when the first call returns `ok: true`, the Agent receives the same tool schema and full result, required artifacts/images are usable by the caller, and the owning runtime closes without leaked resources.

## Published entrypoints

- `@webpilot/capability-media`
- `@webpilot/capability-media/node`
- `@webpilot/capability-media/model-settings`
- `@webpilot/capability-media/models`
- `@webpilot/capability-media/ai-sdk`
- `@webpilot/capability-media/mcp`
- `@webpilot/capability-media/runtime-skill`
- `@webpilot/capability-media/settings`

## Generation provider example

Alternative provider.ts for an image-generation service speaking the compatible Images API. Install `ai@>=7 <8` and `@ai-sdk/openai-compatible`. Set MEDIA_MODEL_BASE_URL, MEDIA_MODEL_ID and MEDIA_MODEL_API_KEY to your actual service. This runnable example lists configured models first. To generate, call media with `{ action: "generateImage", reason: "Create an image", prompt: "A blue ceramic cup", modelRef: "image-main" }`. Change driver/kind and install its SDK for another protocol; generation-only inspect deliberately reports unavailable. The publisher below writes files locally; configure a hosted artifact URL for remote use.

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMediaCapability } from '@webpilot/capability-media';
import { mediaModelConfigurationSchema } from '@webpilot/capability-media/models';
import { createAiSdkMediaGenerationOperations } from '@webpilot/capability-media/ai-sdk';
const model = process.env.MEDIA_MODEL_ID;
const baseURL = process.env.MEDIA_MODEL_BASE_URL;
if (!model || !baseURL) throw new Error('Set MEDIA_MODEL_ID and MEDIA_MODEL_BASE_URL');
const configuration = mediaModelConfigurationSchema.parse({
  models: [{ id: 'image-main', kind: 'image', name: 'My image service',
    driver: 'openai-compatible', model, baseURL, enabled: true,
    apiKey: process.env.MEDIA_MODEL_API_KEY }],
  defaults: { image: 'image-main' },
});
// Register only host-approved source files. Unknown references fail explicitly.
const sources = new Map<string, string>();
if (process.env.MEDIA_SOURCE_PATH) sources.set('sample', path.resolve(process.env.MEDIA_SOURCE_PATH));
const generation = createAiSdkMediaGenerationOperations({
  configuration,
  async readSource(ref) {
    const source = sources.get(ref);
    if (!source) throw new Error('Unknown media source');
    return readFile(source);
  },
  async publishArtifact(file) {
    const directory = path.resolve('./agent-data/generated-media');
    await mkdir(directory, { recursive: true });
    const extensions: Record<string, string> = {
      'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
      'video/mp4': '.mp4', 'audio/mpeg': '.mp3', 'audio/wav': '.wav',
    };
    const fileName = randomUUID() + (extensions[file.mediaType] || '.bin');
    const target = path.join(directory, fileName);
    await writeFile(target, file.data, { flag: 'wx' });
    return { artifactId: fileName, fileName, mediaType: file.mediaType,
      url: pathToFileURL(target).href, downloadUrl: pathToFileURL(target).href };
  },
});
const provider = createMediaCapability({ createOperations: () => ({
  ...generation,
  async inspect() { throw new Error('Inspection is not configured in this generation-only host'); },
}) });
export const providers = [provider];
export const configurations = {};
export const exampleCall = { name: 'media', input: {
  action: 'listModels', reason: 'Inspect available generation models',
} };
export async function cleanup() {}
```

## Additional package reference

The following pre-existing reference includes focused API fragments and application integration notes. The complete runnable entrypoints are the numbered tutorial above; do not concatenate unrelated snippets.

## @webpilot/capability-media

Portable media operations for OCR, transcription, video frame extraction, inspection, and image/video/speech generation. Providers resolve opaque source references and publish outputs through host artifact storage; raw host paths never need to enter model input.

### TypeScript Agent framework integration

```ts
import { createMediaCapability, type MediaOperations } from '@webpilot/capability-media';

const mediaOperations: MediaOperations = {
  inspect: (sourceRef, context) => mediaBackend.inspect(sourceRef, context),
  ocr: (input, context) => mediaBackend.ocr(input, context),
};

const provider = createMediaCapability({
  createOperations: () => mediaOperations,
});
```

`mediaBackend` represents the host-selected OCR, transcription, inspection, or
generation implementation. Register the provider with `mountCapabilities()`,
expose the resolved `media` tool through the consuming TypeScript Agent
framework, inject the package Skill, and preserve artifact metadata in the returned
`data` field. See the complete
[TypeScript Agent framework integration guide](../capability-sdk/FRAMEWORK_INTEGRATION.md).

### Media generation

Artifact-producing actions return each file once in `data`, without duplicating
the file list in `content`. A host-published artifact includes its `artifactId`,
file name, media type, inline `url`, and `downloadUrl`. Use `url` for image embeds
and `downloadUrl` for downloads; copy application-relative URLs without adding a host.

`./models` exports the shared configuration schema and protocol driver catalog. Each
model has its own `kind`, stable `id`, protocol `driver`, provider `model` id,
credentials, base URL, optional path overrides, generation defaults and timeout.
`defaults` selects a model independently for image, video and speech. Removing a
model removes its configuration and secret; blank keys preserve the saved key,
while `clearApiKey` explicitly removes it. Public snapshots redact keys.

The application keeps four model types under each unified provider. Provider
name, enabled state and API key are shared. Each type maintains its own model
list, default model, base URL, endpoint paths and request parameters. The four
types use the same model-list editor; generation types add their own parameters.
The host expands each type into runtime model records with the shared API key
and provider-scoped references before calling this adapter. The
conversation selector stores chat, image, video and speech selections independently.
Choosing a media model never replaces the language model. Agent media operations
use the selected model for that media type and save results to the conversation
artifact store. The adapter selectedModels option takes precedence over agent
modelRef arguments.

The `./model-settings` entrypoint exports type configuration schemas, defaults,
form field definitions, provider-scoped selections and runtime model resolution.
The application renders those definitions with its shared UI components.

The optional `./ai-sdk` entrypoint exports
`createAiSdkMediaGenerationOperations({ configuration, readSource, publishArtifact })`.
Compose its operations with `createFfmpegMediaOperations(...)` or a host's own
inspection backend, then pass the combined operations to `createMediaCapability`.
Generation does not require FFmpeg. The core package does not load AI SDK;
install `ai` and the SDK packages for the selected providers when using this adapter.

| Driver | Image | Video | Speech |
| --- | --- | --- | --- |
| OpenAI | Images API | — | Speech API |
| OpenAI compatible | Images API, base64 or URL responses | — | OpenAI Speech protocol |
| MiniMax | Native image generation, base64 or URL responses, subject references | — | — |
| Google | Imagen / Gemini image | Veo | Gemini TTS |
| xAI | Grok image | Grok video | xAI TTS (no model id) |
| Alibaba | — | Wan / native DashScope | — |

Provider implementations own request formats, authentication and video polling.
A base URL or path override does not translate one provider's protocol into
another. Paths are relative to the configured base URL and preserve the shown
`{model}`, `{id}` or `{operation}` placeholders. Extra parameters use the selected
AI SDK provider's option names (OpenAI-compatible image parameters are raw API
body fields). No model names are hard-coded into the runtime.

MiniMax image generation uses its native `aspect_ratio`, `width` / `height`, and
`subject_reference` fields; masks are unsupported. Existing OpenAI-compatible
image settings that point to `/image_generation` on an official MiniMax API host
are recognized automatically. For custom gateways, select the MiniMax driver.

The `media` tool exposes `listModels`, `generateImage`, `generateVideo` and
`generateSpeech`. Use the configuration id as `modelRef`, or omit it for the
type's default model. Image edits accept `sourceRefs` and optional `maskRef`;
image-to-video accepts one reference image. Speech converts `prompt` into audio,
not music or sound effects. Results are saved artifacts with media types and
download URLs, never large base64 payloads in tool history.

Generation propagates cancellation and uses the configured total timeout;
video polling is bounded. Automatic generation retries are disabled because
resubmitting a paid generation may duplicate work. Cancelling locally does not
promise cancellation of a remote provider job.

FFmpeg inspects stream headers with zero output duration. Cancellation and
timeouts terminate its child process tree and reject the operation; partial
stderr is not treated as successful inspection.

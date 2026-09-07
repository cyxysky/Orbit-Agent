# @webpilot/capability-media

Portable media operations for OCR, transcription, video frame extraction, inspection, and image/video/speech generation. Providers resolve opaque source references and publish outputs through host artifact storage; raw host paths never need to enter model input.

## TypeScript Agent framework integration

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
framework, inject the package Skill, and preserve returned image/artifact
content. See the complete
[TypeScript Agent framework integration guide](../capability-sdk/FRAMEWORK_INTEGRATION.md).

## Media generation

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

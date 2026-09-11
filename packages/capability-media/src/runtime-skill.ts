import type { CapabilitySkill } from '@webpilot/capability-sdk';
export const mediaRuntimeSkillId = 'system-media-runtime';
export const mediaRuntimeSkill = Object.freeze({
  id: mediaRuntimeSkillId, title: 'Media Runtime',
  summary: `<system_skill id="${mediaRuntimeSkillId}">Inspect media before expensive processing, use bounded frame/OCR/transcription scopes, and label generated versus source media accurately.</system_skill>`,
  content: `# Media Runtime

- Inspect the source before choosing OCR, transcription, or frame extraction. Use the smallest adequate page, time, language, and frame scope. Preserve timestamps and source references. OCR/transcription are probabilistic; flag uncertain names, numbers and inaudible text.
- Use listModels to discover built-in and configured image, video, and speech models. modelRef is the returned configuration id; omit it to use the selected model of that type. Host-selected models are independent of the language model and take precedence over modelRef. The built-in Codex CLI image model uses local login and requires no API configuration; it supports reference images but not masks. Never invent model ids or API endpoints.
- generateImage accepts prompt, optional sourceRefs and maskRef for editing, size and count. generateVideo accepts prompt, at most one starting image in sourceRefs, duration, size and aspectRatio. generateSpeech converts exact prompt text into speech with optional voice, language and outputFormat; it does not generate music or sound effects.
- Reference inputs must be registered attachment ids or artifact URLs. Credentials and service paths belong to host settings, never tool arguments.
- Video generation waits for completion. Do not resubmit a timed-out generation automatically: the remote job may still run.
- Generated media is ALREADY saved by the host. Do not download it again with file.download, browser fetch or codeSandbox. For PPT/Word/PDF use, the file tool automatically mounts saved media as document assets. file plan/list returns availableAssets: match artifactId to ref and use the exact assetName. To add new images to an existing draft, list assets and edit the SAME draft; do not regenerate it.
- Clearly label generated media; never present it as source evidence. Actions return each saved file once in data. Use the exact url for Markdown images/inline media and downloadUrl for download links. These are delivery URLs, not instructions to download into a workspace. Copy them verbatim: a leading slash is application-relative, not a hostname. Never add a scheme, invent a domain, or invent attachment://, sandbox:, file: or filesystem URLs.`,
  required: true, activation: [{ toolName: 'media', actions: ['listModels', 'inspect', 'extractFrames', 'ocr', 'transcribe', 'generateImage', 'generateVideo', 'generateSpeech'] }],
} satisfies CapabilitySkill);

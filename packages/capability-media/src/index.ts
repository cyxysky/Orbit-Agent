import { z } from 'zod';
import { defineCapabilityInput, defineCapabilityTool, normalizeBoundedInteger, type CapabilityExecutionContext, type CapabilityHealth, type CapabilityManifest, type CapabilityProvider, type CapabilityRunContext } from '@webpilot/capability-sdk';
import { mediaRuntimeSkill } from './runtime-skill.ts';
import { mediaCapabilitySettings } from './settings.ts';
import type { MediaGenerationInput, MediaGenerationOperations } from './generation.ts';
export * from './runtime-skill.ts';
export * from './settings.ts';
export * from './generation.ts';

export const mediaCapabilityToolNames = Object.freeze({ media: 'media' } as const);
export type MediaArtifact = { artifactId: string; mediaType?: string; url?: string; downloadUrl?: string; fileName?: string; description?: string };
export interface MediaOperations extends MediaGenerationOperations {
  inspect(sourceRef: string, context: CapabilityExecutionContext): Promise<unknown>;
  extractFrames?(input: { sourceRef: string; intervalSeconds?: number; maxFrames: number }, context: CapabilityExecutionContext): Promise<MediaArtifact[]>;
  ocr?(input: { sourceRef: string; language?: string }, context: CapabilityExecutionContext): Promise<unknown>;
  transcribe?(input: { sourceRef: string; language?: string; timestamps: boolean }, context: CapabilityExecutionContext): Promise<unknown>;
  health?(): Promise<CapabilityHealth>;
  dispose?(): Promise<void>;
}
export const mediaGenerationActions = ['generateImage', 'generateVideo', 'generateSpeech'] as const;
const parser = z.object({
  action: z.enum(['listModels', 'inspect', 'extractFrames', 'ocr', 'transcribe', ...mediaGenerationActions]),
  reason: z.string().trim().min(1).max(300),
  sourceRef: z.string().trim().min(1).max(8_000).optional(),
  sourceRefs: z.array(z.string().trim().min(1).max(8_000)).max(10).optional(),
  maskRef: z.string().trim().min(1).max(8_000).optional(),
  modelRef: z.string().trim().min(1).max(1_000).optional(),
  prompt: z.string().trim().min(1).max(20_000).optional(),
  language: z.string().trim().min(2).max(40).optional(),
  timestamps: z.boolean().optional(),
  intervalSeconds: z.number().min(0.1).max(3600).optional(),
  maxFrames: z.number().int().min(1).max(60).optional(),
  size: z.string().regex(/^\d+x\d+$/).optional(),
  aspectRatio: z.string().regex(/^\d+:\d+$/).optional(),
  count: z.number().int().min(1).max(10).optional(),
  duration: z.number().positive().max(600).optional(),
  voice: z.string().trim().min(1).max(200).optional(),
  outputFormat: z.string().trim().min(1).max(40).optional(),
}).strict().superRefine((input, context) => {
  const generation = mediaGenerationActions.some((action) => action === input.action);
  const issue = (path: string, message: string) => context.addIssue({ code: 'custom', path: [path], message });
  if (!generation && input.action !== 'listModels' && !input.sourceRef) issue('sourceRef', `${input.action} requires sourceRef.`);
  if (generation && !input.prompt) issue('prompt', `${input.action} requires prompt.`);
  if (generation && input.sourceRef) issue('sourceRef', 'Use sourceRefs for generation reference images.');
  if (input.maskRef && (input.action !== 'generateImage' || !input.sourceRefs?.length)) issue('maskRef', 'A mask requires generateImage and reference images.');
  if (input.action === 'generateVideo' && (input.sourceRefs?.length || 0) > 1) issue('sourceRefs', 'Video generation accepts one starting image.');
  if (input.action === 'generateSpeech' && (input.sourceRefs?.length || (input.count ?? 1) !== 1)) issue('sourceRefs', 'Speech generation accepts text and produces one audio file.');
});
export type MediaToolInput = z.infer<typeof parser>;
export const mediaToolInput = defineCapabilityInput<MediaToolInput>(z.toJSONSchema(parser) as Readonly<Record<string, unknown>>, (value) => parser.parse(value));
export const mediaCapabilityManifest = Object.freeze({
  schemaVersion: 1, id: 'com.webpilot.media', name: 'Media', version: '0.1.0',
  description: 'Inspect media and generate images, videos, and speech through built-in or configured model providers.',
  permissions: ['artifact:read', 'artifact:write', 'media:process', 'model:media'],
  runtimeRequirements: { node: '>=22.16' }, configuration: { settings: mediaCapabilitySettings }, skills: [mediaRuntimeSkill],
} satisfies CapabilityManifest);

export function createMediaTool(operations: MediaOperations, configuration: CapabilityRunContext['configuration']) {
  return defineCapabilityTool<MediaToolInput, unknown>({
    name: 'media', description: 'List built-in and configured image/video/speech models; generate or edit images, generate videos or text-to-speech audio; inspect media, extract video frames, run OCR or transcription. Generation returns saved artifacts.',
    input: mediaToolInput, policy: { concurrency: 'serial', concurrencyGroup: 'media-processing', permissions: mediaCapabilityManifest.permissions },
    async execute(input, context) {
      try {
        context.abortSignal?.throwIfAborted();
        let data: unknown;
        const unavailable = (name: string) => ({ ok: false as const, error: { code: 'media-operation-unavailable', message: `${name} is not configured.` } });
        if (input.action === 'listModels') data = await operations.listModels?.() || [];
        else if (input.action === 'inspect') data = await operations.inspect(input.sourceRef!, context);
        else if (input.action === 'extractFrames') {
          if (!operations.extractFrames) return unavailable('Frame extraction');
          const limit = normalizeBoundedInteger(configuration.AGENT_MEDIA_MAX_FRAMES, 12, 1, 60);
          data = await operations.extractFrames({ sourceRef: input.sourceRef!, intervalSeconds: input.intervalSeconds, maxFrames: Math.min(input.maxFrames || limit, limit) }, context);
        } else if (input.action === 'ocr') {
          if (!operations.ocr) return unavailable('OCR');
          data = await operations.ocr({ sourceRef: input.sourceRef!, language: input.language }, context);
        } else if (input.action === 'transcribe') {
          if (!operations.transcribe) return unavailable('Transcription');
          data = await operations.transcribe({ sourceRef: input.sourceRef!, language: input.language, timestamps: input.timestamps !== false }, context);
        } else {
          const generate = operations[input.action];
          if (!generate) return unavailable(input.action);
          const request: MediaGenerationInput = {
            prompt: input.prompt!, modelRef: input.modelRef, sourceRefs: input.sourceRefs, maskRef: input.maskRef,
            size: input.size as MediaGenerationInput['size'], aspectRatio: input.aspectRatio as MediaGenerationInput['aspectRatio'],
            count: input.count, duration: input.duration, voice: input.voice, outputFormat: input.outputFormat, language: input.language,
          };
          data = await generate(request, context);
        }
        return { ok: true, summary: `Media ${input.action} completed.`, data };
      } catch (error) {
        return { ok: false, error: { code: context.abortSignal?.aborted ? 'media-operation-aborted' : 'media-operation-failed', message: error instanceof Error ? error.message : String(error), retryable: false } };
      }
    },
  });
}
export function createMediaCapability(options: { createOperations(context: CapabilityRunContext): MediaOperations | Promise<MediaOperations> }): CapabilityProvider {
  return { manifest: mediaCapabilityManifest, async createRuntime(context) {
    const operations = await options.createOperations(context);
    return { tools: Object.freeze({ media: createMediaTool(operations, context.configuration) }), health: () => operations.health?.() || Promise.resolve({ status: 'healthy' }), dispose: () => operations.dispose?.() || Promise.resolve() };
  } };
}

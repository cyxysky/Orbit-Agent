import { z } from 'zod';

const source = z.string().trim().min(1).max(8_000);
export const videoSizeSchema = z.string().regex(/^\d+x\d+$/).refine(value => value.split('x').map(Number).every(n => n >= 128 && n <= 1920 && n % 2 === 0), '画面宽高必须为 128 至 1920 之间的偶数。');
export const videoSceneSchema = z.object({
  sourceRef: source, duration: z.number().min(0.1).max(600),
  kind: z.enum(['image', 'video']).optional(),
  trimStart: z.number().min(0).max(86_400).optional(),
  muted: z.boolean().optional(),
  motion: z.enum(['none', 'zoomIn', 'zoomOut', 'panLeft', 'panRight']).optional(),
  caption: z.string().trim().max(500).optional(),
}).strict();
export const videoEditDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200), size: videoSizeSchema,
  scenes: z.array(videoSceneSchema.extend({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), label: z.string().trim().min(1).max(200) }).strict()).min(1).max(60),
  audio: z.object({ sourceRef: source, label: z.string().max(200), offset: z.number().min(0).max(600),
    trimStart: z.number().min(0).max(86_400), duration: z.number().min(0.1).max(600), volume: z.number().min(0).max(1) }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.scenes.reduce((total, scene) => total + scene.duration, 0) > 600) ctx.addIssue({ code: 'custom', message: '视频总时长不能超过 600 秒。' });
  if (new Set(value.scenes.map(scene => scene.id)).size !== value.scenes.length) ctx.addIssue({ code: 'custom', message: '分镜 ID 不能重复。' });
});
export type VideoEditDocument = z.infer<typeof videoEditDocumentSchema>;
export type VideoProject = { id: string; revision: number; document: VideoEditDocument; outputUrl?: string; renderedRevision?: number; createdAt: string; updatedAt: string };
export function videoDuration(document: VideoEditDocument) { return document.scenes.reduce((sum, scene) => sum + scene.duration, 0); }
export function compositionFromVideoDocument(document: VideoEditDocument) {
  return { scenes: document.scenes.map(({ id, label, ...scene }) => { void id; void label; return scene; }), size: document.size,
    audioRef: document.audio?.sourceRef, audioOffset: document.audio?.offset, audioTrimStart: document.audio?.trimStart,
    audioDuration: document.audio?.duration, audioVolume: document.audio?.volume };
}

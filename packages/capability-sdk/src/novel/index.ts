import { z } from 'zod';
import { defineCapabilityInput, defineCapabilityTool, type CapabilityExecutionContext, type CapabilityManifest, type CapabilityProvider, type CapabilityRunContext } from '../index.ts';
import { novelRuntimeSkill } from './runtime-skill.ts';
import type { NovelReviewReport } from './review.ts';
import { novelEditSchema } from './edits.ts';
export * from './review.ts';
export * from './edits.ts';
export * from './validation.ts';

const text = z.string().trim().min(1);
// Authoring payloads may contain extra model annotations. Strip those keys
// while still validating every required field and workflow prerequisite.
export const novelPlanSchema = z.object({
  title: text,
  idea: text,
  outline: text.describe('Overall plot, conflict, development and ending; not chapter prose.'),
  timeline: z.array(z.object({ time: text, event: text })).min(1).describe('Required array of {time: string, event: string}; use consistent time anchors.'),
  background: text.describe('Setting, world rules and historical/social background.'),
  characters: z.array(z.object({ name: text, role: text, description: text })).min(1).describe('Required plan.characters array, separate from background and outline.'),
  style: text.describe('A single string describing perspective, tone, language, pacing and audience. Do not send an object.'),
  chapters: z.array(z.object({ title: text, summary: text })).min(1)
    .describe('Ordered chapter outline; chapter numbers are 1-based positions.'),
});
export const novelChapterSchema = z.object({
  number: z.number().int().min(1).describe('Required 1-based chapter number, inside chapter. For example: chapter: {number: 1, title, content, summary, continuity}.'),
  title: text,
  content: z.string().min(1).refine(value => Boolean(value.trim()), 'Chapter prose cannot be blank.')
    .describe('Complete chapter prose, never a placeholder or synopsis. Preserve whitespace and paragraph formatting.'),
  summary: text,
  continuity: text.describe('Established facts, character changes, timeline position and unresolved threads for later chapters.'),
});
const parser = z.object({
  action: z.enum(['plan', 'edit', 'validate', 'confirmPlan', 'writeChapter', 'read', 'list', 'export'])
    .describe('Choose the operation first, then supply its required fields. plan creates/replaces an outline; edit patches the existing entity; writeChapter saves a complete chapter; read retrieves it. Unrelated extra fields are ignored.'),
  reason: z.string().trim().min(1).max(300),
  projectId: z.string().trim().min(1).max(100).optional()
    .describe('Required for edit, validate, confirmPlan, writeChapter, read and export. Omit only for list or creating a new plan. Use the exact projectId returned by the tool.'),
  expectedRevision: z.number().int().positive().optional()
    .describe('Required for edit, confirmPlan, writeChapter, and plan when updating an existing projectId. Use the latest returned revision, never planVersion. Optional version check for validate.'),
  plan: novelPlanSchema.optional().describe('Required only for action=plan. Supply the complete plan object with every required field.'),
  chapter: novelChapterSchema.optional()
    .describe('Required only for action=writeChapter. Supply {number, title, content, summary, continuity}; all five fields are required. The number is inside this object.'),
  edits: z.array(novelEditSchema).min(1).optional().describe('Required only for action=edit. Nonempty array of JSON Pointer edits; add/replace requires value.'),
  chapterNumber: z.number().int().min(1).optional()
    .describe('For read, optionally select one complete chapter. For writeChapter, prefer chapter.number; a matching duplicate or an alias for a missing chapter.number is accepted. Conflicting numbers are rejected.'),
}).superRefine((input, context) => {
  const issue = (field: string, message: string) => context.addIssue({ code: 'custom', path: [field], message });
  if (!['plan', 'list'].includes(input.action) && !input.projectId) issue('projectId', 'This action requires projectId.');
  if (input.action === 'plan' && !input.plan) issue('plan', 'Supply the complete proposed plan.');
  if (input.action === 'writeChapter' && !input.chapter) issue('chapter', 'Supply the complete chapter.');
  if (input.action === 'edit' && !input.edits) issue('edits', 'Supply targeted edits to the saved novel entity.');
  if (input.action === 'writeChapter' && input.chapterNumber !== undefined && input.chapter
    && input.chapterNumber !== input.chapter.number) issue('chapterNumber', 'chapterNumber conflicts with chapter.number. Supply one unambiguous chapter number.');
  if (['edit', 'confirmPlan', 'writeChapter'].includes(input.action) || (input.action === 'plan' && input.projectId)) {
    if (!input.expectedRevision) issue('expectedRevision', 'Read the project and supply its current revision.');
  }
});

// Keep the provider-facing schema flat, with action requirements in field
// descriptions. Like the browser tool, prune copied fields from other actions
// before validation instead of rejecting an otherwise complete operation.
function normalizeNovelToolInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const raw = value as Record<string, unknown>;
  const fields: Record<string, readonly string[]> = {
    plan: ['projectId', 'expectedRevision', 'plan'],
    edit: ['projectId', 'expectedRevision', 'edits'],
    validate: ['projectId', 'expectedRevision'],
    confirmPlan: ['projectId', 'expectedRevision'],
    writeChapter: ['projectId', 'expectedRevision', 'chapter', 'chapterNumber'],
    read: ['projectId', 'chapterNumber'],
    list: [],
    export: ['projectId'],
  };
  if (typeof raw.action !== 'string' || !Object.hasOwn(fields, raw.action)) return value;
  const input: Record<string, unknown> = { action: raw.action, reason: raw.reason,
    ...Object.fromEntries(fields[raw.action].filter(key => raw[key] !== undefined).map(key => [key, raw[key]])) };
  if (input.action === 'writeChapter' && input.chapter && typeof input.chapter === 'object' && !Array.isArray(input.chapter)) {
    const chapter = input.chapter as Record<string, unknown>;
    if (chapter.number === undefined && input.chapterNumber !== undefined) input.chapter = { ...chapter, number: input.chapterNumber };
    // Keep conflicting values for the parser to explain; never guess the target.
    if ((input.chapter as Record<string, unknown>).number === input.chapterNumber) delete input.chapterNumber;
  }
  return input;
}
export type NovelPlan = z.infer<typeof novelPlanSchema>;
export type NovelChapterInput = z.infer<typeof novelChapterSchema>;
export type NovelToolInput = z.infer<typeof parser>;
export type NovelProject = {
  id: string; revision: number; planVersion: number; approvedPlanVersion?: number;
  approvedAt?: string; plan: NovelPlan;
  planReview?: NovelReviewReport;
  chapters: Array<NovelChapterInput & { planVersion: number; updatedAt: string; review?: NovelReviewReport;
    editedBy?: 'human' | 'ai'; contextStale?: boolean; reviewStale?: boolean }>;
  createdAt: string; updatedAt: string;
};
export type NovelConfirmationRequest = { input: NovelToolInput; projectId: string; revision: number; planVersion: number; plan: NovelPlan; prompt: string };
export type NovelArtifact = { artifactId: string; fileName: string; url: string; downloadUrl: string; mediaType: string };
export interface NovelOperations {
  execute(input: NovelToolInput, context: CapabilityExecutionContext): Promise<unknown>;
  dispose?(): Promise<void>;
}
export const novelToolInput = defineCapabilityInput<NovelToolInput>(z.toJSONSchema(parser, { io: 'input' }) as Readonly<Record<string, unknown>>, (value) => parser.parse(normalizeNovelToolInput(value)));
export const novelCapabilityManifest = Object.freeze({
  schemaVersion: 1, id: 'com.webpilot.novel', name: 'Novel', version: '0.1.0',
  description: 'Develop a story idea into a complete plan, request user confirmation, then persist chapters and export a manuscript.',
  permissions: ['novel:read', 'novel:write', 'artifact:write'],
  runtimeRequirements: { node: '>=22.16' }, skills: [novelRuntimeSkill],
} satisfies CapabilityManifest);
export function createNovelCapability(options: { createOperations(context: CapabilityRunContext): NovelOperations | Promise<NovelOperations> }): CapabilityProvider {
  return { manifest: novelCapabilityManifest, async createRuntime(context) {
    const operations = await options.createOperations(context);
    const novel = defineCapabilityTool<NovelToolInput, unknown>({
      name: 'novel', description: 'Persist and edit ONE shared novel entity. plan creates the draft; edit applies targeted JSON Pointer edits to that same projectId/revision; writeChapter saves prose after user confirmation. Every write synchronously returns canonical before/after content changes and deterministic validation. No reviewer model is called. YOU inspect the returned changes and checks, judge continuity/accuracy/style, and continue substantive edits until no further change is needed. validate rechecks the saved entity without changing it. Read/list, confirmPlan, export are also available.',
      inputExamples: [
        { action: 'read', reason: '读取当前小说版本及章节目录', projectId: 'novel_returned_project_id' },
        { action: 'writeChapter', reason: '保存已确认方案的第一章', projectId: 'novel_returned_project_id', expectedRevision: 2,
          chapter: { number: 1, title: '雨夜来信', content: '雨水沿着窗缝滴进来。林青把信挪到灯下，拆开了封口。', summary: '林青在雨夜收到并拆开来信。', continuity: '第一夜，林青家中；林青已拆信，寄信者身份尚未揭晓。' } },
        { action: 'edit', reason: '修正第一章摘要', projectId: 'novel_returned_project_id', expectedRevision: 3,
          edits: [{ op: 'replace', path: '/chapters/0/summary', value: '林青在雨夜收到来信，拆信后发现寄信者使用了旧名字。' }] },
      ],
      input: novelToolInput, policy: { concurrency: 'serial', concurrencyGroup: 'novel', permissions: novelCapabilityManifest.permissions },
      async execute(input, execution) {
        try {
          execution.abortSignal?.throwIfAborted();
          return { ok: true, summary: `Novel ${input.action} completed.`, data: await operations.execute(input, execution) };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { ok: false, error: { code: 'novel-operation-failed', message, retryable: false,
            details: { saved: false, changes: [], projectId: input.projectId, expectedRevision: input.expectedRevision,
              ...(error instanceof z.ZodError ? { validationErrors: error.issues } : {}),
              nextAction: 'No changes from this call were committed. Correct the indicated input or read and reconcile a version conflict, then edit the same entity. There is no reviewer model or revision quota.' } } };
        }
      },
    });
    return { tools: { novel }, health: async () => ({ status: 'healthy' as const }), dispose: () => operations.dispose?.() || Promise.resolve() };
  } };
}

export function formatNovelPlan(plan: NovelPlan) {
  return [
    `# ${plan.title}`, `## 创作点子\n\n${plan.idea}`, `## 故事大纲\n\n${plan.outline}`,
    `## 时间线\n\n${plan.timeline.map((entry) => `- ${entry.time}：${entry.event}`).join('\n')}`,
    `## 故事背景\n\n${plan.background}`,
    `## 人物介绍\n\n${plan.characters.map((character) => `### ${character.name}\n\n${character.role}\n\n${character.description}`).join('\n\n')}`,
    `## 文本风格\n\n${plan.style}`,
    `## 章节安排\n\n${plan.chapters.map((chapter, index) => `### 第 ${index + 1} 章 ${chapter.title}\n\n${chapter.summary}`).join('\n\n')}`,
  ].join('\n\n');
}

import { getErrorCode } from "../errors.ts";
import { z } from 'zod';
import { defineCapabilityInput, defineCapabilityTool, type CapabilityExecutionContext, type CapabilityManifest, type CapabilityProvider, type CapabilityRunContext } from '../index.ts';
import { textEditorRuntimeSkill } from './runtime-skill.ts';
import { ERROR_CODES } from '../errors.ts';


export const textFormatSchema = z.enum(['text', 'markdown', 'html']);
export type TextFormat = z.infer<typeof textFormatSchema>;
export type TextDocument = { id: string; title: string; format: TextFormat; content: string; createdAt: string; updatedAt: string };
export type TextDocumentSummary = Omit<TextDocument, 'content'> & { contentChars: number };
export type TextArtifact = { artifactId: string; fileName: string; url: string; downloadUrl: string; mediaType: string };
const parser = z.object({
  action: z.enum(['create', 'list', 'read', 'write', 'edit', 'append', 'delete', 'export']),
  reason: z.string().optional(),
  documentId: z.string().regex(/^text_[a-f0-9-]{36}$/).optional().describe('Exact documentId returned by create/list. Required for every existing-document action.'),
  title: z.string().trim().min(1).max(240).optional(),
  format: textFormatSchema.optional().describe('text, markdown or html; defaults to markdown for new documents.'),
  content: z.string().optional().describe('Source text for create/write, or the exact text to append. Empty content is valid. write replaces the complete source; use edit for local changes.'),
  edits: z.array(z.object({ oldText: z.string().min(1), newText: z.string() })).min(1).optional().describe('For edit: exact, unique oldText/newText replacements, applied atomically in order. Empty newText deletes the matched text.'),
  offset: z.number().int().min(0).optional().describe('For read: UTF-16 source offset. Follow contentRange.nextOffset for the next page.'),
  limit: z.number().int().min(1).max(8000).optional().describe('For read: page length. Defaults to 2000 when offset is present; omit offset and limit for full content.'),
  expectedContent: z.string().optional().describe('Optional exact source snapshot to prevent overwriting a document edited since it was read.'),
  expectedTitle: z.string().optional(),
  expectedFormat: textFormatSchema.optional(),
}).superRefine((input, context) => {
  const issue = (field: string, message: string) => context.addIssue({ code: 'custom', path: [field], message });
  if (!['create', 'list'].includes(input.action) && !input.documentId) issue('documentId', 'This action requires documentId.');
  if (['write', 'append'].includes(input.action) && input.content === undefined && (input.action === 'append' || (input.title === undefined && input.format === undefined))) issue('content', 'Supply content, or a title/format change for write.');
  if (input.action === 'edit' && !input.edits) issue('edits', 'Supply exact text replacements.');
});
export type TextEditorInput = z.infer<typeof parser>;
export const textEditorInput = defineCapabilityInput<TextEditorInput>(z.toJSONSchema(parser, { io: 'input' }) as Readonly<Record<string, unknown>>, value => parser.parse(value));
export type TextEditorOperations = { execute(input: TextEditorInput, context: CapabilityExecutionContext): Promise<unknown>; dispose?(): void | Promise<void> };
export const textEditorCapabilityManifest = Object.freeze({
  schemaVersion: 1, id: 'com.webpilot.text-editor', name: 'Text Editor', version: '0.1.0',
  description: 'Create, read, edit and export independent plain text, Markdown and HTML documents.',
  permissions: ['text:read', 'text:write', 'artifact:write'], runtimeRequirements: { node: '>=22.16' }, skills: [textEditorRuntimeSkill],
} satisfies CapabilityManifest);
export function createTextEditorCapability(options: { createOperations(context: CapabilityRunContext): TextEditorOperations | Promise<TextEditorOperations> }): CapabilityProvider {
  return { manifest: textEditorCapabilityManifest, async createRuntime(context) {
    const operations = await options.createOperations(context);
    const tool = defineCapabilityTool<TextEditorInput, unknown>({
      name: 'textEditor', description: 'Create and edit persistent, independent text documents shared with the text editor UI. Formats: text, markdown, html. No chapter, outline, review or confirmation workflow. All actions execute directly. create returns documentId; reuse it for read/write/edit/append/delete/export. read supports offset/limit and contentRange.nextOffset. Never overwrite a complete document from a partial read: use exact unique oldText/newText edits to preserve other content. Each mutation returns metadata, not the entire source. export returns the actual saved source as a downloadable file.',
      input: textEditorInput, inputExamples: [
        { action: 'create', title: '项目说明', format: 'markdown', content: '# 项目说明\n\n这里是正文。' },
        { action: 'edit', documentId: 'text_00000000-0000-0000-0000-000000000000', edits: [{ oldText: '这里是正文。', newText: '这里是修改后的正文。' }] },
      ], policy: { concurrency: 'serial', concurrencyGroup: 'text-editor', permissions: textEditorCapabilityManifest.permissions },
      async execute(input, execution) {
        try { execution.abortSignal?.throwIfAborted(); return { ok: true, summary: `Text document ${input.action} completed.`, data: await operations.execute(input, execution) }; }
        catch (error) { return { ok: false, error: { code: getErrorCode(error, ERROR_CODES.TEXT_EDITOR_OPERATION_FAILED), message: error instanceof Error ? error.message : String(error), retryable: false } }; }
      },
    });
    return { tools: { textEditor: tool }, health: async () => ({ status: 'healthy' as const }), dispose: () => operations.dispose?.() || Promise.resolve() };
  } };
}

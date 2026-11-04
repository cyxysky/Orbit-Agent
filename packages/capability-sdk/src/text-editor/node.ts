import { randomUUID } from 'node:crypto';
import { createCapabilityDocumentDatabase } from '../node.ts';
import type { CapabilityExecutionContext } from '../index.ts';
import { textEditorInput, type TextArtifact, type TextDocument, type TextDocumentSummary, type TextEditorOperations } from './index.ts';
import { CodedError, ERROR_CODES } from '../errors.ts';


export function createTextDocumentStore(directory: string) {
  return createCapabilityDocumentDatabase<TextDocument>({ directory, filename: 'documents.db', legacyFilename: 'documents.json',
    readLegacy(value) { if (!Array.isArray(value)) throw new CodedError(ERROR_CODES.TEXT_EDITOR_OPERATION_FAILED, 'Invalid legacy text documents.'); return value as TextDocument[]; } });
}
export function textDocumentSummary(document: TextDocument): TextDocumentSummary {
  const { content, ...metadata } = document; return { ...metadata, contentChars: content.length };
}
/** Iterate one source document at a time; listing must not retain every full body. */
export function listTextDocumentSummaries(store: ReturnType<typeof createTextDocumentStore>): TextDocumentSummary[] {
  const summaries: TextDocumentSummary[] = [];
  for (const row of store.database().prepare('SELECT record_json FROM records ORDER BY updated_at DESC, id DESC').iterate()) {
    summaries.push(textDocumentSummary(JSON.parse(String(row.record_json)) as TextDocument));
  }
  return summaries;
}
export function replaceDocumentText(content: string, edits: readonly { oldText: string; newText: string }[]) {
  let result = content;
  for (const edit of edits) {
    if (!edit.oldText) throw new CodedError(ERROR_CODES.TEXT_EDITOR_OPERATION_FAILED, 'oldText must not be empty.');
    const start = result.indexOf(edit.oldText);
    if (start < 0) throw new CodedError(ERROR_CODES.TEXT_EDITOR_OPERATION_FAILED, 'The original text was not found. Read the current source before editing.');
    if (result.indexOf(edit.oldText, start + 1) >= 0) throw new CodedError(ERROR_CODES.TEXT_EDITOR_OPERATION_FAILED, 'The original text is ambiguous. Include more surrounding source.');
    result = result.slice(0, start) + edit.newText + result.slice(start + edit.oldText.length);
  }
  return result;
}
export function createFileTextEditorOperations(options: {
  directory: string; prepareStore?(store: ReturnType<typeof createTextDocumentStore>): void;
  publishArtifact(fileName: string, content: string, context: CapabilityExecutionContext): Promise<TextArtifact>;
}): TextEditorOperations {
  const store = createTextDocumentStore(options.directory);
  function get(id: string) { const document = store.get(id); if (!document) throw new CodedError(ERROR_CODES.TEXT_EDITOR_OPERATION_FAILED, 'Text document not found. Use list to find an existing document.'); return document; }
  return { async execute(raw, context) {
    const input = textEditorInput.parse(raw); context.abortSignal?.throwIfAborted(); options.prepareStore?.(store);
    if (input.action === 'list') return { documents: listTextDocumentSummaries(store) };
    if (input.action === 'create') return store.transaction(() => {
      const now = new Date().toISOString(), document: TextDocument = { id: `text_${randomUUID()}`, title: input.title || '未命名文档', format: input.format || 'markdown', content: input.content ?? '', createdAt: now, updatedAt: now };
      store.save(document); return { documentId: document.id, saved: true, document: textDocumentSummary(document) };
    });
    if (['write', 'edit', 'append', 'delete'].includes(input.action)) return store.transaction(db => {
      const document = get(input.documentId!);
      if ((input.expectedContent !== undefined && input.expectedContent !== document.content)
        || (input.expectedTitle !== undefined && input.expectedTitle !== document.title)
        || (input.expectedFormat !== undefined && input.expectedFormat !== document.format)) throw new CodedError(ERROR_CODES.TEXT_EDITOR_OPERATION_FAILED, '文档已在其他位置修改，请重新读取后再保存。');
      if (input.action === 'delete') {
        db.prepare('DELETE FROM records WHERE id=?').run(document.id);
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='edit_proposals'").get()) db.prepare("DELETE FROM edit_proposals WHERE json_extract(data, '$.documentId')=?").run(document.id);
        return { documentId: document.id, deleted: true, saved: true };
      }
      const content = input.action === 'edit' ? replaceDocumentText(document.content, input.edits!)
        : input.action === 'append' ? document.content + input.content! : input.content ?? document.content;
      const next = { ...document, content, title: input.action === 'write' ? input.title ?? document.title : document.title,
        format: input.action === 'write' ? input.format ?? document.format : document.format };
      const changed = next.content !== document.content || next.title !== document.title || next.format !== document.format;
      if (changed) { next.updatedAt = new Date().toISOString(); store.save(next); }
      return { documentId: next.id, saved: true, changed, document: textDocumentSummary(next) };
    });
    const document = get(input.documentId!);
    if (input.action === 'read') {
      const offset = input.offset ?? 0;
      if (offset > document.content.length) throw new CodedError(ERROR_CODES.TEXT_EDITOR_OPERATION_FAILED, 'Read offset is beyond the end of the document.');
      const splitsCharacter = (position: number) => position > 0 && position < document.content.length
        && /[\uD800-\uDBFF]/.test(document.content[position - 1]) && /[\uDC00-\uDFFF]/.test(document.content[position]);
      if (splitsCharacter(offset)) throw new CodedError(ERROR_CODES.TEXT_EDITOR_OPERATION_FAILED, 'Read offset splits a Unicode character. Follow contentRange.nextOffset.');
      let end = input.offset !== undefined || input.limit !== undefined ? Math.min(document.content.length, offset + (input.limit ?? 2000)) : document.content.length;
      if (splitsCharacter(end)) end = end - 1 === offset ? end + 1 : end - 1;
      return { documentId: document.id, document: { ...document, content: document.content.slice(offset, end) },
        contentRange: { offset, end, totalChars: document.content.length, complete: offset === 0 && end === document.content.length,
          ...(end < document.content.length ? { nextOffset: end } : {}) } };
    }
    const extension = document.format === 'markdown' ? 'md' : document.format === 'html' ? 'html' : 'txt';
    const title = document.title.replace(/\.(?:txt|md|markdown|html?)$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100).replace(/[. ]+$/, '') || 'document';
    const artifact = await options.publishArtifact(`${document.id}-${title}.${extension}`, document.content, context);
    return { documentId: document.id, artifact };
  }, dispose: store.dispose };
}

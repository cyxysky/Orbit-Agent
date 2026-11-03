import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { textFormatSchema, type TextDocument } from '@cjfclonedeep/capability-sdk/text-editor';
import { textDocumentSummary } from '@cjfclonedeep/capability-sdk/text-editor/node';
import type { TextEditProposal } from '@/lib/text-editor';
import { createUserTextDocumentStore } from './text-storage';
import { rewriteTextSelection } from '@/server/ai/text-edit';
import { ApiRequestError } from '@/server/http/api-request';

const identity = { documentId: z.string().regex(/^text_[a-f0-9-]{36}$/) };
const draft = z.object({ title: z.string().trim().min(1).max(240), format: textFormatSchema, content: z.string() }).strict();
export const textWorkspaceInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('create'), document: draft }).strict(),
  z.object({ action: z.literal('read'), ...identity }).strict(),
  z.object({ action: z.literal('save'), ...identity, document: draft, expected: draft.optional() }).strict(),
  z.object({ action: z.literal('delete'), ...identity }).strict(),
  z.object({ action: z.literal('rewrite'), ...identity, document: draft, instruction: z.string().trim().min(1), wholeDocument: z.boolean(),
    selection: z.object({ start: z.number().int().min(0), end: z.number().int().min(0), text: z.string() }).strict() }).strict(),
  z.object({ action: z.literal('apply'), ...identity, proposalId: z.string().uuid() }).strict(),
]);
type StoredProposal = TextEditProposal & { format: TextDocument['format'] };
export async function executeTextWorkspace(raw: unknown, userId: string, signal?: AbortSignal, services = { rewrite: rewriteTextSelection }) {
  const input = textWorkspaceInput.parse(raw), store = createUserTextDocumentStore(userId);
  function get(id: string) { const document = store.get(id); if (!document) throw new ApiRequestError('文档不存在，或当前账号无权访问。', { status: 404 }); return document; }
  try {
    signal?.throwIfAborted();
    const db = store.database();
    if (input.action === 'list') return { documents: db.prepare('SELECT record_json FROM records ORDER BY updated_at DESC, id DESC').all().map(row => textDocumentSummary(JSON.parse(String(row.record_json)) as TextDocument)) };
    if (input.action === 'create') return store.transaction(() => {
      const now = new Date().toISOString(), document: TextDocument = { ...input.document, id: `text_${randomUUID()}`, createdAt: now, updatedAt: now };
      store.save(document); return { document };
    });
    const document = get(input.documentId);
    if (input.action === 'read') return { document };
    if (input.action === 'save') return store.transaction(() => {
      const current = get(input.documentId);
      if (input.expected && (current.content !== input.expected.content || current.title !== input.expected.title || current.format !== input.expected.format)) throw new ApiRequestError('文档已在其他位置修改，请重新读取后再保存。当前输入仍保留在编辑器中。', { status: 409 });
      const next = { ...current, ...input.document };
      if (next.content !== current.content || next.title !== current.title || next.format !== current.format) { next.updatedAt = new Date().toISOString(); store.save(next); }
      return { document: next };
    });
    if (input.action === 'delete') return store.transaction(() => {
      get(input.documentId); db.prepare('DELETE FROM records WHERE id=?').run(input.documentId);
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='edit_proposals'").get()) db.prepare("DELETE FROM edit_proposals WHERE json_extract(data, '$.documentId')=?").run(input.documentId);
      return { deletedDocumentId: input.documentId };
    });
    db.exec('CREATE TABLE IF NOT EXISTS edit_proposals (id TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL)');
    db.prepare('DELETE FROM edit_proposals WHERE expires_at < ?').run(Date.now());
    if (input.action === 'apply') return store.transaction(() => {
      const row = db.prepare('SELECT data FROM edit_proposals WHERE id=?').get(input.proposalId);
      if (!row) throw new ApiRequestError('修改建议已过期，请重新生成。', { status: 409 });
      const proposal = JSON.parse(String(row.data)) as StoredProposal, current = get(input.documentId);
      if (proposal.documentId !== current.id || proposal.format !== current.format) throw new ApiRequestError('文档或格式已改变，请重新生成修改。', { status: 409 });
      let start = proposal.start;
      if (proposal.wholeDocument) {
        if (current.content !== proposal.original) throw new ApiRequestError('原文已改变，请重新生成整篇修改。', { status: 409 });
        start = 0;
      } else if (current.content.slice(start, start + proposal.original.length) !== proposal.original) {
        start = current.content.indexOf(proposal.original);
        if (start < 0 || current.content.indexOf(proposal.original, start + 1) >= 0) throw new ApiRequestError('原选区已改变或无法唯一定位，请重新选择。', { status: 409 });
      }
      const next = { ...current, content: current.content.slice(0, start) + proposal.replacement + current.content.slice(start + proposal.original.length), updatedAt: new Date().toISOString() };
      store.save(next); db.prepare('DELETE FROM edit_proposals WHERE id=?').run(proposal.id); return { document: next };
    });
    const { start, end, text } = input.selection;
    if (document.content !== input.document.content || document.title !== input.document.title || document.format !== input.document.format) throw new ApiRequestError('文档已改变，请先保存或重新读取。', { status: 409 });
    if (start > end || end > document.content.length || document.content.slice(start, end) !== text
      || (input.wholeDocument ? start !== 0 || end !== document.content.length : start === end)) throw new ApiRequestError('选区与当前源码不一致，请重新选择。');
    const result = await services.rewrite({ document: input.document, selection: input.selection, instruction: input.instruction, wholeDocument: input.wholeDocument }, { invocationId: randomUUID(), abortSignal: signal });
    signal?.throwIfAborted();
    return store.transaction(() => {
      get(document.id);
      const proposal: StoredProposal = { id: randomUUID(), documentId: document.id, start, end, original: text, replacement: result.replacement, wholeDocument: input.wholeDocument, format: document.format };
      db.prepare('INSERT INTO edit_proposals VALUES (?, ?, ?)').run(proposal.id, JSON.stringify(proposal), Date.now() + 24 * 60 * 60 * 1000);
      const { format, ...visible } = proposal; void format; return { proposal: visible };
    });
  } finally { await store.dispose(); }
}

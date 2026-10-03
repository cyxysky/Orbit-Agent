import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createNovelDocumentStore } from '@cjfclonedeep/capability-sdk/novel/node';
import { validateNovel, novelContentChanges, novelChapterSchema, type NovelProject, type NovelChapterInput } from '@cjfclonedeep/capability-sdk/novel';
import type { CapabilityExecutionContext } from '@cjfclonedeep/capability-sdk';
import type { NovelEditProposal, NovelWorkspaceProject } from '@/lib/novel-editor';
import { normalizeApplicationUserId } from '@/server/auth/user-context';
import { novelUserDirectory } from './novel-storage';
import { ApiRequestError } from '@/server/http/api-request';
import { rewriteNovelSelection } from '@/server/ai/novel-edit';

const identity = { projectId: z.string().regex(/^novel_[a-f0-9-]{36}$/), revision: z.number().int().positive() };
const draft = z.object({ number: z.number().int().min(1), title: z.string().trim().min(1), content: z.string().min(1).refine(value => Boolean(value.trim())) }).strict();
export const novelWorkspaceInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('read'), projectId: identity.projectId, chapterNumber: z.number().int().min(1).optional() }).strict(),
  z.object({ action: z.literal('save'), ...identity, chapter: draft }).strict(),
  z.object({ action: z.literal('rewrite'), ...identity, chapter: draft, instruction: z.string().trim().min(1),
    selection: z.object({ start: z.number().int().min(0), end: z.number().int().min(1), text: z.string().min(1) }).strict() }).strict(),
  z.object({ action: z.literal('apply'), ...identity, proposalId: z.string().uuid() }).strict(),
]);
type StoredProposal = NovelEditProposal & { chapter: NovelChapterInput };
type Store = ReturnType<typeof createNovelDocumentStore>;
function readProject(store: Store, id: string, revision?: number) {
  const project = store.get(id);
  if (!project) throw new ApiRequestError('小说不存在，或当前账号无权访问。', { status: 404 });
  if (revision !== undefined && project.revision !== revision) throw new ApiRequestError('小说已在其他窗口或对话中更新。请先保留当前文字并重新读取，再合并修改。', { status: 409, code: 'revision_conflict' });
  return project;
}
function view(project: NovelProject): NovelWorkspaceProject {
  return { id: project.id, title: project.plan.title, revision: project.revision, plan: project.plan, updatedAt: project.updatedAt,
    confirmed: project.approvedPlanVersion === project.planVersion,
    chapters: project.chapters.map(chapter => ({ number: chapter.number, title: chapter.title, contentChars: chapter.content.length,
      editedBy: chapter.editedBy, contextStale: chapter.contextStale })) };
}
function chapterAt(project: NovelProject, number: number) {
  const chapter = project.chapters.find(chapter => chapter.number === number);
  if (!chapter) throw new ApiRequestError('该章节尚未生成。请先在对话中完成章节创作。', { status: 404 });
  return chapter;
}
function saveChapter(store: Store, project: NovelProject, chapter: NovelProject['chapters'][number]) {
  const previous = project.chapters.find(item => item.number === chapter.number);
  const changes = novelContentChanges(previous ? novelChapterSchema.parse(previous) : undefined, novelChapterSchema.parse(chapter), `/chapters/${chapter.number - 1}`);
  project.chapters = project.chapters.map(item => item.number === chapter.number ? chapter : item);
  project.revision++; project.updatedAt = new Date().toISOString(); store.save(project);
  return { project: view(project), chapter, changes, validation: validateNovel(project) };
}
export async function executeNovelWorkspace(raw: unknown, userId: string, signal?: AbortSignal, services = { rewrite: rewriteNovelSelection }) {
  const input = novelWorkspaceInput.parse(raw), owner = normalizeApplicationUserId(userId);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(owner)) throw new ApiRequestError('用户身份无效。');
  // Same per-user store as the agent tool; no second manuscript copy.
  const store = createNovelDocumentStore(novelUserDirectory(owner));
  try {
    signal?.throwIfAborted();
    if (input.action === 'list') {
      const rows = store.database().prepare(`SELECT id, updated_at, json_extract(record_json, '$.plan.title') AS title,
        json_array_length(record_json, '$.chapters') AS chapters FROM records ORDER BY updated_at DESC`).all();
      return { projects: rows.map(row => ({ id: String(row.id), title: String(row.title), chapterCount: Number(row.chapters), updatedAt: String(row.updated_at) })) };
    }
    const project = readProject(store, input.projectId, 'revision' in input ? input.revision : undefined);
    if (input.action === 'read') return { project: view(project), ...(input.chapterNumber ? { chapter: chapterAt(project, input.chapterNumber) } : {}) };
    if (input.action === 'save') return store.transaction(() => {
      const current = readProject(store, input.projectId, input.revision), previous = chapterAt(current, input.chapter.number);
      if (previous.title === input.chapter.title && previous.content === input.chapter.content) return { project: view(current), chapter: previous, changes: [], validation: validateNovel(current) };
      return saveChapter(store, current, { ...previous, ...input.chapter, editedBy: 'human', contextStale: true, review: undefined,
        reviewStale: undefined, updatedAt: new Date().toISOString() });
    });
    const db = store.database();
    db.exec('CREATE TABLE IF NOT EXISTS edit_proposals (id TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL)');
    db.prepare('DELETE FROM edit_proposals WHERE expires_at < ?').run(Date.now());
    if (input.action === 'apply') return store.transaction(() => {
      const row = db.prepare('SELECT data FROM edit_proposals WHERE id=?').get(input.proposalId);
      if (!row) throw new ApiRequestError('修改建议已过期，请重新生成。', { status: 409 });
      const proposal = JSON.parse(String(row.data)) as StoredProposal;
      if (proposal.projectId !== input.projectId || proposal.revision !== input.revision) throw new ApiRequestError('修改建议与当前小说版本不一致。', { status: 409 });
      const current = readProject(store, input.projectId, input.revision), previous = chapterAt(current, proposal.chapterNumber);
      const result = saveChapter(store, current, { ...previous, ...proposal.chapter, editedBy: 'ai', contextStale: false,
        reviewStale: undefined, review: undefined, planVersion: current.planVersion, updatedAt: new Date().toISOString() });
      db.prepare('DELETE FROM edit_proposals WHERE id=?').run(input.proposalId);
      return result;
    });
    const previous = chapterAt(project, input.chapter.number), { start, end, text } = input.selection;
    if (start >= end || end > input.chapter.content.length || input.chapter.content.slice(start, end) !== text) throw new ApiRequestError('选中文字已变化，请重新选择后修改。');
    const execution: CapabilityExecutionContext = { invocationId: randomUUID(), abortSignal: signal };
    const chapter: NovelChapterInput = { ...input.chapter, summary: previous.contextStale ? '人工修改后摘要待更新，以正文为准。' : previous.summary,
      continuity: previous.contextStale ? '人工修改后设定记录待更新，以正文为准。' : previous.continuity };
    signal?.throwIfAborted();
    const rewritten = await services.rewrite({ project, chapter, selection: input.selection, instruction: input.instruction }, execution);
    signal?.throwIfAborted();
    const candidate = novelChapterSchema.parse({ ...chapter, content: chapter.content.slice(0, start) + rewritten.replacement + chapter.content.slice(end),
      summary: rewritten.summary, continuity: rewritten.continuity });
    const candidateProject = { ...project, chapters: project.chapters.map(item => item.number === chapter.number
      ? { ...item, ...candidate, contextStale: false, planVersion: project.planVersion } : item) };
    const validation = validateNovel(candidateProject);
    return store.transaction(() => {
      readProject(store, input.projectId, input.revision);
      const proposal: StoredProposal = { id: randomUUID(), projectId: input.projectId, revision: input.revision, chapterNumber: chapter.number,
        start, end, original: text, replacement: rewritten.replacement, validation, chapter: candidate };
      db.prepare('INSERT INTO edit_proposals VALUES (?, ?, ?)').run(proposal.id, JSON.stringify(proposal), Date.now() + 24 * 60 * 60 * 1000);
      const { chapter: storedChapter, ...result } = proposal; void storedChapter;
      return { proposal: result, validation };
    });
  } finally { await store.dispose(); }
}

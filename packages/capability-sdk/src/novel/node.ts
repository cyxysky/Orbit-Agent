import { randomUUID } from 'node:crypto';
import { createCapabilityDocumentDatabase } from '../node.ts';
import type { CapabilityExecutionContext } from '../index.ts';
import { formatNovelPlan, novelToolInput, novelPlanSchema, novelChapterSchema, type NovelArtifact, type NovelConfirmationRequest, type NovelOperations, type NovelProject } from './index.ts';
import { applyNovelEdits, novelContentChanges, type NovelEdit } from './edits.ts';
import { validateNovel } from './validation.ts';

export function createNovelDocumentStore(directory: string) {
  return createCapabilityDocumentDatabase<NovelProject>({
    directory, filename: 'novels.db', legacyFilename: 'novels.json',
    readLegacy() { throw new Error('Legacy novel import is not supported.'); },
  });
}

export function createFileNovelOperations(options: {
  directory: string;
  requestConfirmation?(request: NovelConfirmationRequest, context: CapabilityExecutionContext): Promise<'confirmed' | 'cancelled'>;
  publishArtifact(fileName: string, content: string, context: CapabilityExecutionContext): Promise<NovelArtifact>;
}): NovelOperations {
  const store = createNovelDocumentStore(options.directory);
  function get(id: string, revision?: number) {
    const project = store.get(id);
    if (!project) throw new Error('Novel project not found. Use list to find an existing project.');
    if (revision !== undefined && project.revision !== revision) throw new Error(`Novel revision conflict: expected ${revision}, current ${project.revision}. Read the project before continuing.`);
    return project;
  }
  function status(project: NovelProject) {
    return project.approvedPlanVersion === project.planVersion ? 'confirmed' : 'draft';
  }
  function authored(project?: NovelProject) {
    return project ? { plan: project.plan, chapters: project.chapters.map(chapter => novelChapterSchema.parse(chapter)) } : { chapters: [] };
  }
  function receipt(project: NovelProject, previous: NovelProject | null = project) {
    const changes = novelContentChanges(authored(previous ?? undefined), authored(project));
    return { projectId: project.id, revision: project.revision, planVersion: project.planVersion, status: status(project),
      title: project.plan.title, plannedChapters: project.plan.chapters.length, writtenChapters: project.chapters.length, saved: true,
      changed: changes.length > 0, changes, validation: validateNovel(project),
      nextAction: 'Inspect the exact saved changes and validation feedback. YOU judge continuity, accuracy, logic and style. Continue targeted edit on this same project/revision until you judge no further changes necessary. Checks are deterministic, not model approval. No separate reviewer is called.' };
  }
  function edited(project: NovelProject, edits: NovelEdit[]) {
    const updated = applyNovelEdits(project, edits);
    updated.plan = novelPlanSchema.parse(updated.plan);
    if (updated.plan.chapters.length < project.chapters.length) throw new Error('The revised plan cannot remove already written chapters.');
    if (JSON.stringify(updated.plan) !== JSON.stringify(project.plan)) {
      updated.planVersion++;
      delete updated.approvedPlanVersion;
      delete updated.approvedAt;
      delete updated.planReview;
      updated.chapters.forEach(chapter => { delete chapter.review; delete chapter.reviewStale; });
    }
    updated.chapters = updated.chapters.map((chapter, index) => {
      const content = novelChapterSchema.parse(chapter);
      const synchronized = ['summary', 'continuity'].every(field => edits.some(edit => edit.path === `/chapters/${index}/${field}`));
      if (JSON.stringify(content) === JSON.stringify(novelChapterSchema.parse(project.chapters[index])) && !(chapter.contextStale && synchronized)) return chapter;
      delete chapter.review;
      delete chapter.reviewStale;
      const proseChanged = content.content !== project.chapters[index].content || content.title !== project.chapters[index].title;
      return { ...chapter, ...content, editedBy: 'ai', contextStale: (proseChanged || chapter.contextStale === true) && !synchronized,
        updatedAt: new Date().toISOString() };
    });
    return updated;
  }
  function view(project: NovelProject) {
    return {
      projectId: project.id, revision: project.revision, planVersion: project.planVersion,
      status: status(project), plan: project.plan,
      chapters: project.chapters.map((chapter) => ({ number: chapter.number, title: chapter.title, planVersion: chapter.planVersion, contentChars: chapter.content.length,
        contextStale: chapter.contextStale, editedBy: chapter.editedBy })),
      recentChapters: project.chapters.slice(-3).map(chapter => ({ number: chapter.number, title: chapter.title,
        summary: chapter.summary, continuity: chapter.continuity, contextStale: chapter.contextStale, contentChars: chapter.content.length })),
      nextChapterNumber: project.chapters.length < project.plan.chapters.length ? project.chapters.length + 1 : null,
      updatedAt: project.updatedAt,
      validation: validateNovel(project),
    };
  }
  function save(project: NovelProject) {
    project.revision += 1;
    project.updatedAt = new Date().toISOString();
    store.save(project);
  }
  return {
    async execute(raw, context) {
      const input = novelToolInput.parse(raw);
      context.abortSignal?.throwIfAborted();
      if (input.action === 'list') {
        return store.database().prepare(`SELECT id, updated_at, json_extract(record_json, '$.plan.title') AS title,
          json_extract(record_json, '$.revision') AS revision, json_array_length(record_json, '$.chapters') AS chapter_count
          FROM records ORDER BY updated_at DESC, id DESC`).all();
      }
      if (input.action === 'plan') {
        const before = input.projectId ? get(input.projectId, input.expectedRevision) : undefined;
        if (before && input.plan!.chapters.length < before.chapters.length) throw new Error('The revised plan cannot remove already written chapters.');
        if (before && JSON.stringify(before.plan) === JSON.stringify(input.plan)) return receipt(before);
        return store.transaction(() => {
          const previous = input.projectId ? get(input.projectId, input.expectedRevision) : undefined;
          if (previous && input.plan!.chapters.length < previous.chapters.length) throw new Error('The revised plan cannot remove already written chapters.');
          // Retrying an identical saved proposal must not invalidate its approval.
          if (previous && JSON.stringify(previous.plan) === JSON.stringify(input.plan)) return receipt(previous);
          const now = new Date().toISOString();
          const project: NovelProject = {
            id: previous?.id || `novel_${randomUUID()}`, revision: previous?.revision || 0,
            planVersion: (previous?.planVersion || 0) + 1, plan: input.plan!,
            chapters: (previous?.chapters || []).map(chapter => { const next = { ...chapter }; delete next.review; delete next.reviewStale; return next; }),
            createdAt: previous?.createdAt || now, updatedAt: now,
          };
          save(project);
          return receipt(project, previous ?? null);
        });
      }
      if (input.action === 'edit') return store.transaction(() => {
        const project = get(input.projectId!, input.expectedRevision);
        const next = edited(project, input.edits!);
        if (JSON.stringify(next) !== JSON.stringify(project)) save(next);
        return receipt(next, project);
      });
      if (input.action === 'validate') return receipt(get(input.projectId!, input.expectedRevision));
      if (input.action === 'confirmPlan') {
        const project = get(input.projectId!, input.expectedRevision);
        if (status(project) === 'confirmed') return { ...view(project), ...receipt(project) };
        if (!options.requestConfirmation) throw new Error('User confirmation is unavailable. Present the plan; chapter writing remains blocked.');
        const decision = await options.requestConfirmation({
          input, projectId: project.id, revision: project.revision, planVersion: project.planVersion, plan: project.plan,
          prompt: `请确认以下创作方案（第 ${project.planVersion} 版）。确认后开始生成章节正文；需要调整时请取消并提出修改意见。\n\n${formatNovelPlan(project.plan)}`,
        }, context);
        context.abortSignal?.throwIfAborted();
        return store.transaction(() => {
          // Never hold a database lock while waiting for a human. Recheck after the wait.
          const current = get(project.id, project.revision);
          if (decision !== 'confirmed') return { ...view(current), status: 'cancelled', nextAction: 'Wait for the user to request changes. Do not generate chapters.' };
          current.approvedPlanVersion = current.planVersion;
          current.approvedAt = new Date().toISOString();
          save(current);
          return { ...view(current), ...receipt(current, project) };
        });
      }
      if (input.action === 'writeChapter') {
        return store.transaction(() => {
          const project = get(input.projectId!, input.expectedRevision);
          if (status(project) !== 'confirmed') throw new Error('The current plan has not been confirmed by the user. Call confirmPlan before writing chapters.');
          const chapter = input.chapter!;
          if (chapter.number > project.plan.chapters.length) throw new Error('Chapter is outside the approved outline.');
          if (chapter.number > project.chapters.length + 1 || chapter.number < project.chapters.length) throw new Error('Write the next chapter in order, or revise only the latest chapter; earlier chapters are preserved.');
          const before = structuredClone(project);
          const existing = project.chapters[chapter.number - 1];
          if (existing && JSON.stringify(novelChapterSchema.parse(existing)) === JSON.stringify(chapter)) return receipt(project);
          project.chapters[chapter.number - 1] = { ...chapter, planVersion: project.planVersion, updatedAt: new Date().toISOString(), editedBy: 'ai' };
          save(project);
          return { ...receipt(project, before), savedChapter: chapter.number, contentChars: chapter.content.length,
            nextChapterNumber: project.chapters.length < project.plan.chapters.length ? project.chapters.length + 1 : null };
        });
      }
      const project = get(input.projectId!);
      if (input.action === 'read') {
        if (!input.chapterNumber) return view(project);
        const chapter = project.chapters[input.chapterNumber - 1];
        if (!chapter) throw new Error('This chapter has not been written.');
        return { projectId: project.id, revision: project.revision, chapter: { ...novelChapterSchema.parse(chapter), contextStale: chapter.contextStale }, validation: validateNovel(project) };
      }
      const label = status(project) === 'confirmed' ? '方案已确认' : '方案待确认';
      const progress = `> ${label} · 方案版本 ${project.planVersion} · 已写 ${project.chapters.length}/${project.plan.chapters.length} 章`;
      const manuscript = [`# ${project.plan.title}`, progress, ...project.chapters.map((chapter) =>
        `## 第 ${chapter.number} 章 ${chapter.title}\n\n${chapter.planVersion !== project.planVersion ? '> 本章按早期方案创作，请核对与当前方案的一致性。\n\n' : ''}${chapter.content}`)].join('\n\n');
      const artifacts: NovelArtifact[] = [];
      for (const [name, content] of [['manuscript.md', manuscript], ['plan.md', `${progress}\n\n${formatNovelPlan(project.plan)}`]]) {
        context.abortSignal?.throwIfAborted();
        artifacts.push(await options.publishArtifact(`${project.id}-${name}`, content, context));
      }
      return { projectId: project.id, revision: project.revision, writtenChapters: project.chapters.length, plannedChapters: project.plan.chapters.length, artifacts };
    },
    dispose: store.dispose,
  };
}

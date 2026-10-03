import type { NovelPlan, NovelProject, NovelValidation, NovelContentChange } from '@cjfclonedeep/capability-sdk/novel';

export type NovelEditorChapter = NovelProject['chapters'][number];
export type NovelEditorDraft = Pick<NovelEditorChapter, 'number' | 'title' | 'content'>;
export type NovelWorkspaceProject = {
  id: string; revision: number; title: string; plan: NovelPlan; updatedAt: string;
  confirmed: boolean;
  chapters: Array<Pick<NovelEditorChapter, 'number' | 'title' | 'contextStale' | 'reviewStale' | 'editedBy'> & { contentChars: number }>;
};
export type NovelListItem = { id: string; title: string; chapterCount: number; updatedAt: string };
export type NovelEditProposal = {
  id: string; projectId: string; revision: number; chapterNumber: number;
  start: number; end: number; original: string; replacement: string; validation?: NovelValidation;
};
export type NovelEditorResponse = {
  projects?: NovelListItem[]; project?: NovelWorkspaceProject; chapter?: NovelEditorChapter; proposal?: NovelEditProposal;
  changes?: NovelContentChange[]; validation?: NovelValidation;
};
export function novelProjectIdFromFile(fileName: string) {
  return fileName.match(/^(novel_[a-f0-9-]{36})-(?:manuscript|plan)\.md$/i)?.[1];
}

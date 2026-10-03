import { novelChapterSchema, novelPlanSchema, type NovelProject } from './index.ts';
import { inspectNovelPhrases, type NovelReview } from './review.ts';

export type NovelValidation = {
  revision: number;
  structuralValid: boolean;
  phraseRulesPassed: boolean;
  issues: NovelReview['issues'];
  modelJudgmentRequired: true;
};

/** Deterministic feedback only. Plot, facts and prose quality remain the caller model's job. */
export function validateNovel(project: NovelProject): NovelValidation {
  const issues: NovelReview['issues'] = [];
  let structuralValid = true;
  const addStructureIssue = (location: string, explanation: string) => {
    structuralValid = false;
    issues.push({ category: 'logic', severity: 'error', location, quote: '', explanation, suggestion: '修改对应字段后重新校验。' });
  };
  const plan = novelPlanSchema.safeParse(project.plan);
  if (!plan.success) for (const issue of plan.error.issues) addStructureIssue(`plan.${issue.path.join('.')}`, issue.message);
  const phraseIssues = plan.success ? inspectNovelPhrases({ kind: 'plan', plan: plan.data, previousChapters: [] }) : [];
  for (const [index, chapter] of project.chapters.entries()) {
    const checked = novelChapterSchema.safeParse(chapter);
    if (!checked.success) {
      for (const issue of checked.error.issues) addStructureIssue(`chapters[${index}].${issue.path.join('.')}`, issue.message);
      continue;
    }
    if (chapter.number !== index + 1) addStructureIssue(`chapters[${index}].number`, '正文章节顺序与编号不一致。');
    if (plan.success && chapter.number > plan.data.chapters.length) addStructureIssue(`chapters[${index}].number`, '正文章节超出当前大纲安排。');
    if (plan.success) phraseIssues.push(...inspectNovelPhrases({ kind: 'chapter', plan: plan.data, chapter: checked.data, previousChapters: [] })
      .map(issue => ({ ...issue, location: issue.location.replace(/^chapter\./, `chapters[${index}].`) })));
    if (chapter.contextStale) issues.push({ category: 'continuity', severity: 'warning', location: `chapters[${index}]`, quote: '',
      explanation: '正文已修改，旧摘要和连续性记录可能不再准确。', suggestion: '由当前模型核对完整正文，同步更新 summary 和 continuity。' });
    if (chapter.planVersion !== project.planVersion) issues.push({ category: 'continuity', severity: 'warning', location: `chapters[${index}]`, quote: '',
      explanation: '章节依据早期大纲创作。', suggestion: '由当前模型核对与当前设定是否一致，需要时 edit。若已一致，可保留原方案版本的来源记录，无需为了消除提示重复改稿。' });
  }
  return { revision: project.revision, structuralValid, phraseRulesPassed: phraseIssues.length === 0,
    issues: [...issues, ...phraseIssues], modelJudgmentRequired: true };
}

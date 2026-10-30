import type { NovelChapterInput, NovelPlan, NovelProject } from './index.ts';

export type NovelReview = {
  accepted: boolean;
  issues: Array<{ category: 'continuity' | 'accuracy' | 'logic' | 'description' | 'style'; severity: 'error' | 'warning';
    location: string; quote: string; explanation: string; suggestion: string }>;
};
// Compatibility type for historical records only. No model review runs anymore.
export type NovelReviewReport = NovelReview & { checkedAt: string; model: string };
export type NovelReviewRequest = {
  kind: 'plan' | 'chapter'; plan: NovelPlan; chapter?: NovelChapterInput;
  previousChapters: NovelProject['chapters']; followingChapters?: NovelProject['chapters'];
};

// These are explicit editorial rules, not a detector of who wrote a passage.
export const novelPhraseRules = [
  { id: 'fate-gears', pattern: /命运的齿轮.{0,10}(?:开始|悄然|缓缓|再次)?转动/gu, suggestion: '用具体事件推进情节，删除“命运的齿轮”式旁白。' },
  { id: 'stone-ripples', pattern: /(?:一颗|一枚|一块|小小的)?石子.{0,18}(?:湖面|心湖|心海).{0,24}(?:涟漪|波澜)/gu, suggestion: '用符合角色经历的具体反应替代“石子落入心湖”的套用比喻。' },
  { id: 'evil-smile', pattern: /(?:嘴角|唇角).{0,12}(?:勾起|扬起).{0,12}(?:邪魅|意味深长|玩味).{0,8}(?:笑|弧度)/gu, suggestion: '描写有情境依据的表情、动作或对白，避免模板化笑容。' },
  { id: 'invisible-hand', pattern: /(?:仿佛|好似|犹如).{0,8}(?:一只|一双).{0,6}(?:无形|看不见)的手.{0,15}(?:攥|扼|揪|抓|拨动)/gu, suggestion: '直接呈现身体感受或事件的作用，替换无形之手的惯用比喻。' },
  { id: 'unprecedented-determination', pattern: /(?:眼中|眼神|目光).{0,10}(?:闪过|闪烁|透露|透出).{0,10}前所未有的(?:坚定|决绝|光芒)/gu, suggestion: '通过选择和行动表现决心，避免用抽象眼神概括转变。' },
  { id: 'story-just-begun', pattern: /(?:而|但|可|殊不知)[，,\s]*(?:他们|她们|他|她)?的?故事[，,\s]*(?:才|也才|却才)(?:刚刚|刚)?开始/gu, suggestion: '以本章实际发生的变化收尾，删除预告式万能结尾。' },
  { id: 'ai-meta', pattern: /(?:作为(?:一个|一名)?(?:AI|人工智能|语言模型)|以下是(?:为您|为你)?(?:生成|创作|续写)的(?:小说|章节|正文))/giu, suggestion: '删除模型身份和写作说明，直接提供小说内容。' },
] as const;

export function inspectNovelPhrases(request: NovelReviewRequest): NovelReview['issues'] {
  const fields: Array<[string, string]> = request.chapter
    ? [['chapter.content', request.chapter.content]]
    : [['plan.outline', request.plan.outline], ['plan.background', request.plan.background],
      ...request.plan.timeline.map((item, index): [string, string] => [`plan.timeline[${index}].event`, item.event]),
      ...request.plan.characters.map((item, index): [string, string] => [`plan.characters[${index}].description`, item.description]),
      ...request.plan.chapters.map((item, index): [string, string] => [`plan.chapters[${index}].summary`, item.summary])];
  const issues: NovelReview['issues'] = [];
  for (const [field, content] of fields) for (const rule of novelPhraseRules) {
    for (const match of content.matchAll(new RegExp(rule.pattern.source, rule.pattern.flags))) {
      issues.push({ category: 'style', severity: 'error',
        location: `${field}：第 ${content.slice(0, match.index).split('\n').length} 行，字符 ${match.index + 1}`,
        quote: content.slice(Math.max(0, match.index - 20), match.index + match[0].length + 20),
        explanation: `命中写作禁用规则 ${rule.id}：${match[0]}`, suggestion: rule.suggestion });
    }
  }
  return issues;
}

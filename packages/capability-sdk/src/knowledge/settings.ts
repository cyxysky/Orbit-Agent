import type { CapabilitySettingDefinition } from '../index.ts';
export const knowledgeCapabilitySettings = [
  { key: 'AGENT_KNOWLEDGE_PREVIEW_CHARS', label: '知识检索摘要长度', description: '搜索结果的摘要字符数。完整业务规则通过 get 或 inspect 按需读取。', section: 'runtime', group: '知识库', defaultValue: '360', control: 'number', applyMode: 'runtime', min: 100, max: 1800, step: 20 },
  { key: 'AGENT_KNOWLEDGE_SEARCH_LIMIT', label: '知识检索结果上限', description: '单次搜索返回的候选记录数。', section: 'runtime', group: '知识库', defaultValue: '8', control: 'number', applyMode: 'runtime', min: 1, max: 30, step: 1 },
] as const satisfies readonly CapabilitySettingDefinition[];

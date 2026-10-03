export const reasoningEffortValues = ['provider-default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ReasoningEffortSetting = typeof reasoningEffortValues[number];
export function normalizeReasoningEffort(value: unknown): ReasoningEffortSetting {
  return reasoningEffortValues.includes(value as ReasoningEffortSetting) ? value as ReasoningEffortSetting : 'provider-default';
}
export const reasoningEffortOptions = [
  { value: 'provider-default', label: '思考 · 默认' },
  { value: 'none', label: '思考 · 无' },
  { value: 'minimal', label: '思考 · 极低' },
  { value: 'low', label: '思考 · 低' },
  { value: 'medium', label: '思考 · 中' },
  { value: 'high', label: '思考 · 高' },
  { value: 'xhigh', label: '思考 · 极高' },
  { value: 'max', label: '思考 · 最高' },
];

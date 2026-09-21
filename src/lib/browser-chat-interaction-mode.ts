export const browserChatInteractionModes = ['dom', 'visual', 'hybrid'] as const;
export type BrowserChatInteractionMode = typeof browserChatInteractionModes[number];
export function normalizeBrowserChatInteractionMode(value: unknown): BrowserChatInteractionMode {
  return value === 'dom' || value === 'visual' ? value : 'hybrid';
}
export const browserChatInteractionModeOptions = [
  { value: 'hybrid', label: 'DOM + 视觉' },
  { value: 'dom', label: '纯 DOM' },
  { value: 'visual', label: '纯视觉' },
];

import { normalizeDisabledBrowserChatTools } from './browser-chat-tools';

type BrowserChatToolPreferences = {
  disabledTools: string[];
  order: string[];
};

function preferencesKey(userId: string) {
  return `webpilotqa.browser-chat.tools:${encodeURIComponent(userId)}`;
}

function normalizeOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const valid = new Set(normalizeDisabledBrowserChatTools(value));
  return [...new Set(value.filter((name): name is string => typeof name === 'string' && valid.has(name)))];
}

export function readBrowserChatToolPreferences(userId: string): BrowserChatToolPreferences {
  try {
    const value = JSON.parse(window.localStorage.getItem(preferencesKey(userId)) || '{}');
    return { disabledTools: normalizeDisabledBrowserChatTools(value?.disabledTools), order: normalizeOrder(value?.order) };
  } catch {
    return { disabledTools: [], order: [] };
  }
}

export function saveBrowserChatToolPreferences(userId: string, patch: Partial<BrowserChatToolPreferences>) {
  const current = readBrowserChatToolPreferences(userId);
  const next = {
    disabledTools: patch.disabledTools === undefined ? current.disabledTools : normalizeDisabledBrowserChatTools(patch.disabledTools),
    order: patch.order === undefined ? current.order : normalizeOrder(patch.order),
  };
  window.localStorage.setItem(preferencesKey(userId), JSON.stringify(next));
}

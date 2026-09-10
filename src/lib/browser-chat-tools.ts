export type BrowserChatToolHelp = {
  name: string;
  label: string;
  description: string;
  prompts: string[];
  available: boolean;
};

export function normalizeDisabledBrowserChatTools(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((name): name is string =>
    typeof name === 'string' && /^[a-zA-Z][\w.-]{0,79}$/.test(name)))].slice(0, 64).sort() : [];
}

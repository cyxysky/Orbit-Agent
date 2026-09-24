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

/** A blocked report is not a verification request. Any later browser call supersedes the request. */
export function browserChatHasPendingHumanInput(
  tools: readonly { name: string; ok?: boolean; input?: unknown }[],
) {
  const latest = tools.findLast((tool) => tool.name === 'browser');
  const input = latest?.input;
  return latest?.ok === true && !!input && typeof input === 'object'
    && 'action' in input && ['waitForHumanVerification', 'requestUserInput'].includes(String(input.action));
}

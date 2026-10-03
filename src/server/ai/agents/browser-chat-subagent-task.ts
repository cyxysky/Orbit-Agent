export type BrowserChatSubagentTaskInput = {
  instruction: string;
  title: string;
  url?: string;
};

export type BrowserChatSubagentTask = Omit<BrowserChatSubagentTaskInput, 'url'> & { url: string };

export type BrowserChatSubagentReadInput = {
  uuid: string;
};

export function normalizeBrowserChatSubagentTasks(value: unknown): BrowserChatSubagentTask[] {
  const values = Array.isArray(value) ? value : [value];
  const tasks: BrowserChatSubagentTask[] = [];
  for (const raw of values) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const input = raw as Record<string, unknown>;
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const instruction = typeof input.instruction === 'string' ? input.instruction.trim() : '';
    const url = typeof input.url === 'string' ? input.url.trim() : '';
    if (!title || !instruction || (input.url !== undefined && typeof input.url !== 'string')
      || (url && !URL.canParse(url))) return [];
    tasks.push({ title, instruction, url });
  }
  return tasks;
}

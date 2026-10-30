export type BrowserChatToolSource = { toolName: string; action?: string };
type Tool = { id?: string; name: string; input?: unknown; result?: unknown; rawResult?: unknown; contentSource?: BrowserChatToolSource };
function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    try { return record(JSON.parse(value)); } catch { return undefined; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function payload(tool: Tool) {
  const raw = record(tool.rawResult);
  return record(raw?.actual ?? raw?.data ?? tool.result);
}

/** Resolve presentation from the content's producer, independently of its transport. */
export function browserChatToolSource(tool: Tool, tools: readonly Tool[]): BrowserChatToolSource | undefined {
  if (tool.name !== 'contextRead') return undefined;
  if (tool.contentSource) return tool.contentSource;
  const result = payload(tool);
  const source = record(result?.source);
  const origin = typeof source?.toolName === 'string' ? {
    toolName: source.toolName, action: typeof source.action === 'string' ? source.action : undefined,
  } : undefined;
  const sourceTool = typeof source?.toolCallId === 'string'
    ? tools.find((candidate) => candidate.id === source.toolCallId && candidate.name === origin?.toolName) : undefined;
  const sourceAction = record(sourceTool?.input)?.action;
  if (origin && typeof sourceAction === 'string') return { ...origin, action: sourceAction };
  if (origin?.action) return origin;
  const ref = record(tool.input)?.ref;
  if (typeof ref !== 'string') return origin;
  for (const page of tools) {
    if (page === tool || page.name !== 'contextRead' || record(page.input)?.ref !== ref) continue;
    const pageSource = page.contentSource || record(payload(page)?.source);
    if (typeof pageSource?.toolName === 'string') return { toolName: pageSource.toolName,
      action: typeof pageSource.action === 'string' ? pageSource.action : undefined };
  }
  // An exact first-page prefix also identifies the producer in loaded history;
  // pagination must retain that identity even when later pages lack a heading.
  const first = tools.map(payload).find((item) => item?.ref === ref && item.offset === 0 && typeof item.content === 'string');
  const prefix = first?.content;
  if (typeof prefix !== 'string' || !prefix.length) return origin;
  const candidates = tools.filter((candidate) => candidate.name !== 'contextRead' && candidate.rawResult
    && (!origin || candidate.name === origin.toolName)
    && JSON.stringify(candidate.rawResult).startsWith(prefix));
  if (candidates.length !== 1) return origin;
  const producer = candidates[0];
  const action = record(producer.input)?.action;
  return { toolName: producer.name, action: typeof action === 'string' ? action : undefined };
}

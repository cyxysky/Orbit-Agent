import type { AiToolContextSnapshot, StepExecutionResult } from '@/server/ai/schemas/runtime.schema';

type RequestLog = { id?: string; phase: string; time?: string; messageId?: string; details?: unknown };
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;

/** Repair the legacy raw-history estimate from actual, adjacent request logs.
 * This is a read projection; the original logs and persisted tool evidence stay intact. */
export function recoverBrowserChatToolContext(steps: readonly StepExecutionResult[], logs: readonly RequestLog[]): StepExecutionResult[] {
  const requests = logs.flatMap((log) => {
    if (log.phase !== 'ai:runtime:request' || !log.time) return [];
    try {
      const parsed = record(typeof log.details === 'string' ? JSON.parse(log.details) : log.details);
      const payload = record(parsed?.value) || parsed;
      const stats = record(payload?.aiInputTokens);
      const total = count(stats?.estimatedTotalTokens);
      const time = Date.parse(log.time);
      if (total === undefined || !Number.isFinite(time)) return [];
      const snapshot: AiToolContextSnapshot = {
        requestId: `request-log:${log.id || log.time}`, requestCreatedAt: log.time,
        estimatedTotalTokens: total, estimatedTextTokens: count(stats?.estimatedTextTokens),
        estimatedToolSchemaTokens: count(stats?.estimatedToolSchemaTokens), estimatedImageTokens: count(stats?.estimatedImageTokens),
        imageCount: count(stats?.imageCount), method: typeof stats?.method === 'string' ? stats.method : undefined,
      };
      return [{ time, log, snapshot }];
    } catch { return []; }
  }).sort((a, b) => a.time - b.time);
  const originIndex = (before: AiToolContextSnapshot, messageId?: string) => {
    const time = Date.parse(before.requestCreatedAt || '');
    if (!Number.isFinite(time)) return -1;
    const index = requests.findIndex((request) => request.time >= time && (!messageId || request.log.messageId === messageId));
    // Missing earlier log pages must not cause us to guess the originating request.
    return index >= 0 && requests[index].snapshot.estimatedTotalTokens === before.estimatedTotalTokens ? index : -1;
  };
  // Reuse the next batch's real request identity whenever it is available.
  for (const step of steps) for (const tool of step.tools || []) {
    if (!tool.contextBefore?.requestId) continue;
    const index = originIndex(tool.contextBefore, step.messageId);
    if (index >= 0) requests[index].snapshot = { ...requests[index].snapshot,
      requestId: tool.contextBefore.requestId, requestCreatedAt: tool.contextBefore.requestCreatedAt };
  }
  return steps.map((step) => ({ ...step, tools: step.tools?.map((tool) => {
    if (tool.name === 'contextCompression' || !tool.contextBefore?.requestId
      || tool.contextAfter?.requestId) return tool;
    const index = originIndex(tool.contextBefore, step.messageId);
    const next = index >= 0 ? requests[index + 1] : undefined;
    if (!next || next.log.messageId !== requests[index].log.messageId) return tool;
    return { ...tool, contextAfter: next.snapshot };
  }) }));
}

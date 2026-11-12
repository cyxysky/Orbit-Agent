import type { AiToolContextSnapshot, StepExecutionResult } from '@/server/ai/schemas/runtime.schema';
import { browserChatRequestContextStatsFromDebugRecord } from './browser-chat-context-usage';
import { calibrateRuntimeRequestContext, runtimeProviderInputTokens } from './runtime-context-budget';

type RequestLog = { id?: string; phase: string; time?: string; messageId?: string; details?: unknown };
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;

/** Resolve tool snapshots against their model requests without modifying stored evidence. */
export function recoverBrowserChatToolContext(steps: readonly StepExecutionResult[], logs: readonly RequestLog[]): StepExecutionResult[] {
  const savedSnapshots = new Map(steps.flatMap(step => (step.tools || []).flatMap(tool => (
    [tool.contextBefore, tool.contextAfter].flatMap(snapshot => snapshot?.requestId ? [[snapshot.requestId, snapshot] as const] : [])
  ))));
  const payload = (log: RequestLog) => {
    try { const parsed = record(typeof log.details === 'string' ? JSON.parse(log.details) : log.details); return record(parsed?.value) || parsed; }
    catch { return; }
  };
  const inputs = new Map(logs.flatMap(log => {
    const value = payload(log);
    const total = runtimeProviderInputTokens(value?.aiOutput);
    return log.phase === 'ai:runtime:response' && typeof value?.modelRequestId === 'string' && total !== undefined
      ? [[value.modelRequestId, total] as const] : [];
  }));
  const requests = logs.flatMap((log) => {
    if (log.phase !== 'ai:runtime:request' || !log.time) return [];
    try {
      const parsed = record(typeof log.details === 'string' ? JSON.parse(log.details) : log.details);
      const payload = record(parsed?.value) || parsed;
      let stats = payload ? browserChatRequestContextStatsFromDebugRecord(payload, 256000) : undefined;
      const modelRequestId = typeof payload?.modelRequestId === 'string' ? payload.modelRequestId : undefined;
      const saved = modelRequestId ? savedSnapshots.get(modelRequestId) : undefined;
      const savedStats = saved ? browserChatRequestContextStatsFromDebugRecord({ modelContextStats: saved }, 256000) : undefined;
      // Prefer the estimate recorded at dispatch to reconstructing a serialized
      // request. Logging may omit repeated fields or replace binary inputs.
      if (savedStats && (!stats || savedStats.actualInputTokens !== undefined
        || savedStats.rawEstimatedTotalTokens !== undefined && stats.estimatedTotalTokens !== savedStats.estimatedTotalTokens)) stats = savedStats;
      const actual = modelRequestId ? inputs.get(modelRequestId) : undefined;
      if (stats && actual !== undefined) stats = calibrateRuntimeRequestContext(stats, actual);
      const total = count(stats?.estimatedTotalTokens);
      const time = Date.parse(log.time);
      if (total === undefined || !Number.isFinite(time)) return [];
      const snapshot: AiToolContextSnapshot = {
        requestId: modelRequestId || `request-log:${log.id || log.time}`, requestCreatedAt: log.time,
        estimatedTotalTokens: total, estimatedTextTokens: count(stats?.estimatedTextTokens),
        estimatedToolSchemaTokens: count(stats?.estimatedToolSchemaTokens), estimatedImageTokens: count(stats?.estimatedImageTokens),
        imageCount: count(stats?.imageCount), method: typeof stats?.method === 'string' ? stats.method : undefined,
        rawEstimatedTotalTokens: count(stats?.rawEstimatedTotalTokens), actualInputTokens: count(stats?.actualInputTokens),
        breakdownAvailable: stats?.breakdownAvailable,
      };
      return [{ time, log, snapshot, modelRequestId }];
    } catch { return []; }
  }).sort((a, b) => a.time - b.time);
  const originIndex = (before: AiToolContextSnapshot, messageId?: string) => {
    const exact = requests.findIndex(request => request.modelRequestId === before.requestId && request.modelRequestId
      && (!messageId || request.log.messageId === messageId));
    if (exact >= 0) return exact;
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
    if (index >= 0 && !requests[index].modelRequestId) requests[index].snapshot = { ...requests[index].snapshot,
      requestId: tool.contextBefore.requestId, requestCreatedAt: tool.contextBefore.requestCreatedAt };
  }
  return steps.map((step) => ({ ...step, tools: step.tools?.map((tool) => {
    if (tool.name === 'contextCompression' || !tool.contextBefore?.requestId) return tool;
    const index = originIndex(tool.contextBefore, step.messageId);
    const before = index >= 0 && requests[index].modelRequestId ? requests[index].snapshot : tool.contextBefore;
    if (tool.contextAfter?.requestId) {
      const after = requests.find(request => request.modelRequestId === tool.contextAfter?.requestId);
      return before === tool.contextBefore && !after ? tool : { ...tool, contextBefore: before, contextAfter: after?.snapshot || tool.contextAfter };
    }
    const next = index >= 0 ? requests[index + 1] : undefined;
    if (!next || next.log.messageId !== requests[index].log.messageId) return before === tool.contextBefore ? tool : { ...tool, contextBefore: before };
    return { ...tool, contextBefore: before, contextAfter: next.snapshot };
  }) }));
}

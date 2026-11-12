import type { AiToolContextSnapshot, StepToolCall } from '@/server/ai/schemas/runtime.schema';

function tokenCount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
}

function elapsedMilliseconds(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
}

type ToolContext = Pick<StepToolCall, 'contextAfter' | 'contextBefore'> & { name?: string };

function contextTokens(snapshot?: AiToolContextSnapshot) {
  const saved = tokenCount(snapshot?.estimatedTotalTokens);
  const estimate = tokenCount(snapshot?.rawEstimatedTotalTokens);
  const count = saved === 0 ? estimate !== undefined && estimate > 0 ? estimate : undefined : saved;
  return { count, estimated: count !== undefined && (count !== saved || snapshot?.method === 'request-estimate') };
}

export function browserChatToolHasLegacyContextAfter(tool: ToolContext) {
  return tool.name !== 'contextCompression' && Boolean(tool.contextBefore?.requestId)
    && tokenCount(tool.contextAfter?.estimatedTotalTokens) !== undefined && !tool.contextAfter?.requestId;
}

export function browserChatToolContextTokenMetrics(tool: ToolContext) {
  const origin = contextTokens(tool.contextBefore);
  const next = contextTokens(tool.contextAfter);
  const before = origin.count;
  const after = browserChatToolHasLegacyContextAfter(tool) ? undefined : next.count;
  return {
    before,
    after,
    beforeEstimated: origin.estimated,
    afterEstimated: next.estimated,
    delta: before !== undefined && after !== undefined ? after - before : undefined,
  };
}

export function browserChatToolTimingMetrics(tool: Pick<StepToolCall, 'aiRequestElapsedMs' | 'elapsedMs'>) {
  return {
    toolElapsedMs: elapsedMilliseconds(tool.elapsedMs),
    aiRequestElapsedMs: elapsedMilliseconds(tool.aiRequestElapsedMs),
  };
}

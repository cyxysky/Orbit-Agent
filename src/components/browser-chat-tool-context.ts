import type { StepToolCall } from '@/server/ai/schemas/runtime.schema';

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

export function browserChatToolHasLegacyContextAfter(tool: ToolContext) {
  return tool.name !== 'contextCompression' && Boolean(tool.contextBefore?.requestId)
    && tokenCount(tool.contextAfter?.estimatedTotalTokens) !== undefined && !tool.contextAfter?.requestId;
}

export function browserChatToolContextTokenMetrics(tool: ToolContext) {
  const before = tokenCount(tool.contextBefore?.estimatedTotalTokens);
  const after = browserChatToolHasLegacyContextAfter(tool) ? undefined : tokenCount(tool.contextAfter?.estimatedTotalTokens);
  return {
    before,
    after,
    delta: before !== undefined && after !== undefined ? after - before : undefined,
  };
}

export function browserChatToolTimingMetrics(tool: Pick<StepToolCall, 'aiRequestElapsedMs' | 'elapsedMs'>) {
  return {
    toolElapsedMs: elapsedMilliseconds(tool.elapsedMs),
    aiRequestElapsedMs: elapsedMilliseconds(tool.aiRequestElapsedMs),
  };
}

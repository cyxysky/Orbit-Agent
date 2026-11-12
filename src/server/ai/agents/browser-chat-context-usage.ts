import { browserChatActiveMessages, type BrowserChatModelContext } from './browser-chat-model-context';
import { calibrateRuntimeRequestContext, estimateRuntimeMessageContext, estimateRuntimeRequestContext, estimateRuntimeTextTokens, runtimeProviderInputTokens, type RuntimeRequestContextStats } from './runtime-context-budget';

export type BrowserChatContextUsageSnapshot = {
  currentTokens: number;
  imageTokens: number;
  maxTokens: number;
  textTokens: number;
  toolTokens: number;
  breakdownAvailable?: boolean;
  method?: string;
};

function contextStatsCandidate(record: Record<string, unknown>, fallbackMaxTokens: number): Record<string, unknown> | undefined {
  const object = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
  const options = object(object(record.aiRequest)?.options);
  const saved = object(record.aiInputTokens ?? record.modelContextStats ?? options?.modelContextStats);
  if (typeof saved?.estimatedTotalTokens === 'number' && saved.estimatedTotalTokens > 0) return saved;
  const request = object(record.aiInput);
  if (request && Array.isArray(request.messages)) {
    const system = typeof request.systemPrompt === 'string' && request.systemPrompt
      ? [{ role: 'system', content: request.systemPrompt }] : [];
    return estimateRuntimeRequestContext({ messages: [...system, ...request.messages], tools: request.tools }, fallbackMaxTokens);
  }
  // A calibrated snapshot retains its original estimate. It remains usable
  // when an adapter supplied zero instead of the provider's missing usage.
  if (typeof saved?.rawEstimatedTotalTokens === 'number' && saved.rawEstimatedTotalTokens > 0) {
    return { ...saved, estimatedTotalTokens: saved.rawEstimatedTotalTokens, actualInputTokens: undefined,
      estimatedTextTokens: undefined, estimatedToolSchemaTokens: undefined, estimatedImageTokens: undefined,
      method: 'request-estimate', breakdownAvailable: false };
  }
}

/** Estimate against the saved request, including legacy background messages only when that request used one. */
export function browserChatActiveContextUsage(
  context: BrowserChatModelContext,
  maxTokens: number,
  fallbackToolTokens = 0,
): BrowserChatContextUsageSnapshot {
  const manifest = context.lastRequest;
  if (manifest?.engine === 'openai-agents') {
    if (manifest.modelContextStats) {
      const usage = browserChatContextUsageFromDebugRecord({ modelContextStats: manifest.modelContextStats }, manifest.contextWindowTokens || maxTokens);
      if (usage) return usage;
    }
    const tokens = Math.max(0, manifest.estimatedTokensAfter);
    return { currentTokens: tokens, maxTokens: manifest.contextWindowTokens || maxTokens,
      imageTokens: 0, textTokens: 0, toolTokens: 0, breakdownAvailable: false, method: 'provider-input' };
  }
  const system = manifest?.systemRef ? context.records[manifest.systemRef]?.content : '';
  const backgroundRef = manifest ? manifest.backgroundRef : context.backgroundRef;
  const background = backgroundRef ? context.records[backgroundRef] : undefined;
  const schema = manifest?.toolSchemaRef ? context.records[manifest.toolSchemaRef]?.content : undefined;
  const estimated = estimateRuntimeMessageContext({
    system: typeof system === 'string' ? system : '',
    messages: [...(background ? [background] : []), ...browserChatActiveMessages(context)],
  });
  const toolTokens = typeof schema === 'string' ? estimateRuntimeTextTokens(schema) : Math.max(0, fallbackToolTokens);
  return { currentTokens: estimated.totalTokens + toolTokens, imageTokens: estimated.imageTokens,
    maxTokens, textTokens: estimated.textTokens, toolTokens };
}

export function browserChatContextUsageFromDebugRecord(
  record: Record<string, unknown>,
  fallbackMaxTokens: number,
): BrowserChatContextUsageSnapshot | undefined {
  const stats = contextStatsCandidate(record, fallbackMaxTokens);
  if (!stats) return undefined;
  const currentTokens = Number(stats.estimatedTotalTokens);
  if (!Number.isFinite(currentTokens) || currentTokens < 0) return undefined;
  const textTokens = Number(stats.estimatedTextTokens);
  const imageTokens = Number(stats.estimatedImageTokens);
  const toolTokens = Number(stats.estimatedToolSchemaTokens);
  const maxTokens = Number(stats.windowTokens);
  return {
    currentTokens: Math.round(currentTokens),
    imageTokens: Number.isFinite(imageTokens) && imageTokens > 0 ? Math.round(imageTokens) : 0,
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? Math.round(maxTokens) : fallbackMaxTokens,
    textTokens: Number.isFinite(textTokens) && textTokens > 0 ? Math.round(textTokens) : 0,
    toolTokens: Number.isFinite(toolTokens) && toolTokens > 0 ? Math.round(toolTokens) : 0,
    ...(typeof stats.breakdownAvailable === 'boolean' ? { breakdownAvailable: stats.breakdownAvailable }
      : stats.engine === 'openai-agents' && !Number.isFinite(textTokens) && !Number.isFinite(toolTokens)
        ? { breakdownAvailable: false } : {}),
    ...(typeof stats.method === 'string' ? { method: stats.method } : {}),
  };
}

export function browserChatRequestContextStatsFromDebugRecord(record: Record<string, unknown>, fallbackMaxTokens: number): RuntimeRequestContextStats | undefined {
  const saved = contextStatsCandidate(record, fallbackMaxTokens);
  if (saved && typeof saved === 'object' && 'breakdownAvailable' in saved && 'method' in saved) return saved as RuntimeRequestContextStats;
  const usage = browserChatContextUsageFromDebugRecord(record, fallbackMaxTokens);
  if (!usage) return;
  return { estimatedTotalTokens: usage.currentTokens, estimatedTextTokens: usage.textTokens,
    estimatedImageTokens: usage.imageTokens, estimatedToolSchemaTokens: usage.toolTokens,
    windowTokens: usage.maxTokens, method: 'request-estimate', breakdownAvailable: usage.breakdownAvailable !== false };
}

export function browserChatContextUsageFromRequestLogs(logs: readonly { phase: string; time?: string; details?: unknown }[], fallbackMaxTokens: number) {
  const parsed = logs.flatMap(log => {
    try {
      const details = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
      const payload = details?.value || details;
      return payload && typeof payload === 'object' ? [{ log, payload: payload as Record<string, unknown> }] : [];
    } catch { return []; }
  });
  const request = parsed.filter(({ log, payload }) => log.phase === 'ai:runtime:request'
    && typeof payload.modelRequestId === 'string' && payload.aiInput)
    .sort((a, b) => (a.log.time || '').localeCompare(b.log.time || '')).at(-1);
  if (!request) return;
  let stats = browserChatRequestContextStatsFromDebugRecord(request.payload, fallbackMaxTokens);
  if (!stats) return;
  const response = parsed.find(({ log, payload }) => log.phase === 'ai:runtime:response'
    && payload.modelRequestId === request.payload.modelRequestId);
  const inputTokens = runtimeProviderInputTokens(response?.payload.aiOutput);
  if (inputTokens !== undefined) stats = calibrateRuntimeRequestContext(stats, inputTokens);
  return browserChatContextUsageFromDebugRecord({ modelContextStats: stats }, fallbackMaxTokens);
}

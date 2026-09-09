import { browserChatActiveMessages, type BrowserChatModelContext } from './browser-chat-model-context';
import { estimateRuntimeMessageContext, estimateRuntimeTextTokens } from './runtime-context-budget';

export type BrowserChatContextUsageSnapshot = {
  currentTokens: number;
  imageTokens: number;
  maxTokens: number;
  textTokens: number;
  toolTokens: number;
};

/** Use the same saved request background for live, idle and restored sessions. */
export function browserChatActiveContextUsage(
  context: BrowserChatModelContext,
  maxTokens: number,
  fallbackToolTokens = 0,
): BrowserChatContextUsageSnapshot {
  const manifest = context.lastRequest;
  const system = manifest?.systemRef ? context.records[manifest.systemRef]?.content : '';
  const backgroundRef = context.backgroundRef || manifest?.backgroundRef;
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
  const candidate = record.aiInputTokens ?? record.modelContextStats;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  const stats = candidate as Record<string, unknown>;
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
  };
}

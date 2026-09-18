import type { ModelMessage } from 'ai';
import type { LanguageModelV4Usage } from '@ai-sdk/provider';

// Generated background is request-local. It must never become dialogue history.
const generatedPrefixes = ['[Conversation background]', '[WebPilot task state]', '[WebPilot material reference]',
  '[WebPilot continuation summary]', '[WebPilot continuation directive]', '[WebPilot knowledge context]',
  '[WebPilot runtime operational context]', '[WebPilot runtime current time]', '[Current browser observation]'];
export function isRuntimePromptCacheMetadataMessage(message: ModelMessage) {
  if (message.role !== 'user') return false;
  const text = typeof message.content === 'string' ? message.content
    : message.content.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n');
  return generatedPrefixes.some((prefix) => text.startsWith(prefix));
}
export function withoutRuntimePromptCacheMetadata(messages: ModelMessage[]) {
  return messages.filter((message) => !isRuntimePromptCacheMetadataMessage(message));
}

/** OpenAI-compatible gateways may forward DeepSeek's native usage fields. */
export function normalizeRuntimeCacheUsage(usage: LanguageModelV4Usage): LanguageModelV4Usage {
  const raw = usage.raw;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return usage;
  const details = raw.prompt_tokens_details;
  if (details && typeof details === 'object' && !Array.isArray(details)
    && typeof details.cached_tokens === 'number') return usage;
  const cacheRead = raw.prompt_cache_hit_tokens;
  const total = usage.inputTokens.total;
  if (typeof cacheRead !== 'number' || !Number.isFinite(cacheRead) || cacheRead < 0
    || typeof total !== 'number' || cacheRead > total) return usage;
  return { ...usage, inputTokens: { ...usage.inputTokens, cacheRead,
    noCache: Math.max(0, total - cacheRead - (usage.inputTokens.cacheWrite || 0)),
  } };
}

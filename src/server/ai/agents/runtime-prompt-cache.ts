import type { ModelMessage } from 'ai';

// Generated background is request-local. It must never become dialogue history.
const generatedPrefixes = ['[Conversation background]', '[WebPilot task state]', '[WebPilot material reference]',
  '[WebPilot continuation summary]', '[WebPilot continuation directive]', '[WebPilot knowledge context]',
  '[WebPilot runtime operational context]', '[WebPilot runtime current time]'];
export function isRuntimePromptCacheMetadataMessage(message: ModelMessage) {
  if (message.role !== 'user') return false;
  const text = typeof message.content === 'string' ? message.content
    : message.content.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n');
  return generatedPrefixes.some((prefix) => text.startsWith(prefix));
}
export function withoutRuntimePromptCacheMetadata(messages: ModelMessage[]) {
  return messages.filter((message) => !isRuntimePromptCacheMetadataMessage(message));
}

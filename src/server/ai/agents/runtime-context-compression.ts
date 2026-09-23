import type { ModelMessage } from 'ai';

function modelMessageContainsToolCall(message: ModelMessage) {
  return message.role === 'assistant'
    && Array.isArray(message.content)
    && message.content.some((part) => part.type === 'tool-call');
}

function modelMessageToolCallIds(message: ModelMessage) {
  if (!modelMessageContainsToolCall(message) || !Array.isArray(message.content)) return new Set<string>();
  return new Set(message.content.flatMap((part) => (
    part.type === 'tool-call' && typeof part.toolCallId === 'string' ? [part.toolCallId] : []
  )));
}
export function completeRuntimeModelToolChain(messages: ModelMessage[]) {
  const complete: ModelMessage[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const callIds = modelMessageToolCallIds(message);
    if (callIds.size) {
      const calls = Array.isArray(message.content) ? message.content.filter(part => part.type === 'tool-call') : [];
      if (calls.length !== callIds.size) throw new Error('Duplicate tool call IDs in a model decision.');
      const callNames = new Map(calls.map(part => [part.toolCallId, part.toolName]));
      const toolMessages: ModelMessage[] = [];
      const resultIds = new Set<string>();
      const assistantContent = Array.isArray(message.content)
        ? message.content.filter((part) => {
            if (part.type !== 'tool-result' || typeof part.toolCallId !== 'string') return true;
            if (callNames.get(part.toolCallId) !== part.toolName || resultIds.has(part.toolCallId)) return false;
            resultIds.add(part.toolCallId);
            return true;
          })
        : message.content;
      let nextIndex = index + 1;
      while (messages[nextIndex]?.role === 'tool') {
        const toolMessage = messages[nextIndex];
        const content = Array.isArray(toolMessage.content)
          ? toolMessage.content.filter((part) => {
              if (part.type !== 'tool-result' || typeof part.toolCallId !== 'string') return false;
              if (callNames.get(part.toolCallId) !== part.toolName || resultIds.has(part.toolCallId)) return false;
              resultIds.add(part.toolCallId);
              return true;
            })
          : [];
        if (content.length) toolMessages.push({ ...toolMessage, content } as ModelMessage);
        nextIndex += 1;
      }
      if ([...callIds].every((toolCallId) => resultIds.has(toolCallId))) {
        complete.push({ ...message, content: assistantContent } as ModelMessage, ...toolMessages);
      } else if (Array.isArray(assistantContent)) {
        // Repair only the request view. Preserve completed siblings and explicitly
        // represent uncertain outcomes instead of silently dropping an attempted action.
        const missing = assistantContent.flatMap(part => part.type === 'tool-call' && !resultIds.has(part.toolCallId) ? [{
          type: 'tool-result' as const, toolCallId: part.toolCallId, toolName: part.toolName,
          output: { type: 'error-json' as const, value: {
            code: 'interrupted-tool-outcome', hostGenerated: true, outcome: 'unknown',
            safeToRetry: false, requiresStateRefresh: true,
            message: 'No durable result exists for this call. It may have executed. Inspect current state or query the operation receipt before deciding whether to retry; do not replay the whole batch.',
          } },
        }] : []);
        complete.push({ ...message, content: assistantContent } as ModelMessage, ...toolMessages,
          { role: 'tool', content: missing });
      }
      index = nextIndex - 1;
      continue;
    }
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      const nonToolResultContent = message.content.filter((part) => part.type !== 'tool-result');
      if (nonToolResultContent.length) {
        complete.push({ ...message, content: nonToolResultContent } as ModelMessage);
      }
      continue;
    }
    if (message.role !== 'tool') complete.push(message);
  }
  return complete;
}

/**
 * Remove one provider-rejected tool exchange without discarding unrelated
 * text or sibling tool calls/results that share the same SDK message.
 */
export function omitRuntimeModelToolExchange(messages: ModelMessage[], toolCallId: string) {
  const normalizedToolCallId = toolCallId.trim();
  if (!normalizedToolCallId) return completeRuntimeModelToolChain(messages);
  const filtered = messages.flatMap((message) => {
    if (!Array.isArray(message.content)) return [message];
    const content = message.content.filter((part) => {
      if (!part || typeof part !== 'object') return true;
      const record = part as { type?: unknown; toolCallId?: unknown };
      return !(
        (record.type === 'tool-call' || record.type === 'tool-result')
        && record.toolCallId === normalizedToolCallId
      );
    });
    return content.length ? [{ ...message, content } as ModelMessage] : [];
  });
  return completeRuntimeModelToolChain(filtered);
}

/** Keep archived evidence intact while excluding retired tool exchanges from a new model request. */
export function omitRuntimeModelToolNames(messages: ModelMessage[], names: ReadonlySet<string>) {
  if (!names.size) return completeRuntimeModelToolChain(messages);
  const omittedIds = new Set(messages.flatMap((message) => (
    message.role === 'assistant' && Array.isArray(message.content)
      ? message.content.flatMap((part) => part.type === 'tool-call' && names.has(part.toolName) ? [part.toolCallId] : [])
      : []
  )));
  const filtered = messages.flatMap((message) => {
    if (!Array.isArray(message.content)) return [message];
    const content = message.content.filter((part) => (
      (part.type !== 'tool-call' && part.type !== 'tool-result')
      || (!names.has(part.toolName) && !omittedIds.has(part.toolCallId))
    ));
    return content.length ? [{ ...message, content } as ModelMessage] : [];
  });
  return completeRuntimeModelToolChain(filtered);
}

export function atomicRuntimeModelMessageBlocks(messages: ModelMessage[]) {
  const blocks: ModelMessage[][] = [];
  const completeMessages = completeRuntimeModelToolChain(messages);
  for (let index = 0; index < completeMessages.length; index += 1) {
    const message = completeMessages[index];
    if (modelMessageContainsToolCall(message)) {
      const block = [message];
      while (completeMessages[index + 1]?.role === 'tool') block.push(completeMessages[++index]);
      blocks.push(block);
      continue;
    }
    blocks.push([message]);
  }
  return blocks;
}

import { jsonRecordFromUnknown, jsonValueFromString } from '@cjfclonedeep/capability-sdk';
import type { BrowserChatSubagentRecord } from '@/server/ai/schemas/runtime.schema';

function browserChatSubagentToolResult(value: unknown) {
  const result = jsonRecordFromUnknown(jsonValueFromString(value));
  if (result?.actual !== undefined) {
    return jsonRecordFromUnknown(typeof result.actual === 'string'
      ? jsonValueFromString(result.actual)
      : result.actual);
  }
  return result;
}

export function browserChatSubagentBatchIdFromToolResult(value: unknown) {
  const batchId = browserChatSubagentToolResult(value)?.batchId;
  return typeof batchId === 'string' ? batchId.trim() : '';
}

export function browserChatSubagentBatchIsPending(value: unknown) {
  const result = browserChatSubagentToolResult(value);
  return result?.asynchronous === true && result.status === 'running';
}

export function browserChatSubagentBatchIsComplete(value: unknown) {
  const result = browserChatSubagentToolResult(value);
  return result?.asynchronous === true && result.status === 'completed';
}

export function browserChatSubagentBatchSize(value: unknown) {
  const subagents = browserChatSubagentToolResult(value)?.subagents;
  return Array.isArray(subagents) ? subagents.length : undefined;
}

export function browserChatSubagentBatchVersion(value: unknown) {
  const result = browserChatSubagentToolResult(value);
  if (result?.asynchronous !== true) return undefined;
  return {
    batchId: typeof result.batchId === 'string' ? result.batchId.trim() : undefined,
    revision: typeof result.revision === 'number' && Number.isFinite(result.revision) ? result.revision : undefined,
    status: result.status,
  };
}

export function browserChatSubagentRecordsForToolCall(
  records: BrowserChatSubagentRecord[],
  toolResult?: unknown,
  toolCallId?: string,
) {
  const batchId = browserChatSubagentBatchIdFromToolResult(toolResult) || toolCallId?.trim();
  if (!batchId) return [];
  return records
    .filter((record) => record.batchId === batchId)
    .sort((left, right) => left.index - right.index);
}

import { normalizeFileToolInput } from '@cjfclonedeep/capability-sdk/file';
import {
  jsonRecordFromUnknown,
  unwrapToolTransport,
} from '@cjfclonedeep/capability-sdk';

/** Scalar transport normalization only; never reshape a document or program. */
export function coerceBrowserChatToolInput(toolName: string, value: unknown) {
  if (toolName === 'browser') {
    const source = jsonRecordFromUnknown(unwrapToolTransport(value));
    // Mode validation belongs to the owning runtime, after transport decoding.
    return source || value;
  }
  return toolName === 'file' ? normalizeFileToolInput(value) : value;
}

export function repairBrowserChatToolCallInput(toolName: string, rawInput: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawInput);
  } catch {
    return undefined;
  }
  const repaired = coerceBrowserChatToolInput(toolName, parsed);
  const serialized = JSON.stringify(repaired);
  return serialized !== JSON.stringify(parsed) ? serialized : undefined;
}

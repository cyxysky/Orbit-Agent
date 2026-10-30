import type { ModelMessage } from 'ai';
import type { BrowserActionResult } from '@cjfclonedeep/capability-sdk/browser/node';
import type { BrowserChatSubagentReadInput } from './browser-chat-subagent-task';
import { subagentRuntimeSkillContent, subagentRuntimeSkillId } from './subagent-runtime-skill';

export type SubagentResultInbox = Record<string, { turnId: string; revision: number; resultRef: string }>;
type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
}

export function subagentResultActual(result: Pick<BrowserActionResult, 'actual'>) {
  try { return record(JSON.parse(result.actual || '{}')); } catch { return {}; }
}

/** Preserve complete tool output, while removing obsolete automatic-delivery instructions. */
export function subagentSpawnResult(result: BrowserActionResult): BrowserActionResult {
  const actual = subagentResultActual(result);
  if (!Array.isArray(actual.subagents)) return result;
  const runtimeSkill = result.runtimeSkill?.skillId === subagentRuntimeSkillId
    ? { ...result.runtimeSkill, content: subagentRuntimeSkillContent } : result.runtimeSkill;
  let incomplete = false;
  const subagents: RecordValue[] = actual.subagents.map(value => {
    const child = record(value);
    const page = record(child.delivery);
    const partial = child.delivery && (page.offset !== 0 || page.complete !== true);
    if (partial) incomplete = true;
    return { ...child, delivery: undefined, ...(partial ? { partial: true } : {}) };
  });
  const pending = subagents.some(child => ['queued', 'running', 'awaiting-confirmation'].includes(String(child.status)));
  return { ...result, ...(runtimeSkill ? { runtimeSkill } : {}), actual: JSON.stringify({
    ...actual, action: 'spawn', asynchronous: pending ? actual.asynchronous : false,
    delivery: undefined, collection: undefined, subagents,
    next: pending || incomplete
      ? 'This is an older unfinished or partial receipt. Use subagent action=read with the exact child uuid to retrieve its full saved result; do not repeat spawn.'
      : 'The full child results are returned here. Assess successful findings, partial results and errors before synthesis; no additional read is required.',
  }) };
}

export function subagentModelMessages(messages: readonly ModelMessage[]): ModelMessage[] {
  return messages.map(message => message.role !== 'tool' ? message : { ...message, content: message.content.map(part => {
    if (part.type !== 'tool-result' || part.toolName !== 'subagent' || !('value' in part.output)) return part;
    let value = part.output.value;
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return part; } }
    const result = record(value);
    if (typeof result.ok !== 'boolean' || typeof result.actual !== 'string') return part;
    const actual = subagentResultActual(result as BrowserActionResult);
    if (actual.action === 'read' && actual.pagination) {
      const page = record(actual.pagination);
      const partial = page.offset !== 0 || page.complete !== true;
      return { ...part, output: { type: 'json' as const, value: JSON.parse(JSON.stringify({ ...result,
        actual: JSON.stringify({ ...actual, collection: undefined, pagination: undefined, partial,
          next: partial ? 'This older receipt contains only part of the result. Use subagent action=read with this uuid to retrieve the entire saved output.'
            : 'The full saved result is returned here. Assess this outcome before synthesis.' }),
      })) } };
    }
    if (!Array.isArray(actual.subagents)) return part;
    return { ...part, output: { type: 'json' as const, value: JSON.parse(JSON.stringify(subagentSpawnResult(result as BrowserActionResult))) } };
  }) });
}

/** Reading an archived/resumed child returns its entire saved result in one call. */
export function subagentReadResult(child: RecordValue, input: BrowserChatSubagentReadInput): BrowserActionResult {
  const pending = ['queued', 'running', 'awaiting-confirmation'].includes(String(child.status));
  const content = typeof child.content === 'string' ? child.content : typeof child.summary === 'string' ? child.summary : '';
  return { ok: true, actual: JSON.stringify({ action: 'read', uuid: input.uuid, batchId: child.batchId,
    title: child.title, status: child.status, pending, resumable: child.resumable === true,
    content, ...(typeof child.error === 'string' ? { error: child.error } : {}),
    next: pending ? 'This older child is still running; the saved result is not complete yet. Do not repeat spawn or use unrelated browser operations to wait.'
      : 'The full saved result is returned here. Assess this outcome, including errors, before synthesis.',
  }) };
}

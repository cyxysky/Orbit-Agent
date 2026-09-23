import { createHash } from 'node:crypto';
import type { ModelMessage } from 'ai';
import { isOriginalBrowserChatUserMessage } from './browser-chat-model-context';

function object(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return undefined; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** Collapse only complete, consecutive browser exchanges with identical
 * no-action evidence in the model request. The archived transcript is intact. */
export function projectRepeatedNoActionHistory(messages: ModelMessage[]) {
  const blocks: ModelMessage[][] = [];
  for (let index = 0; index < messages.length;) {
    let end = index + 1;
    if (messages[index].role === 'assistant') while (messages[end]?.role === 'tool') end++;
    blocks.push(messages.slice(index, end));
    index = end;
  }
  const noActionSignature = (block: ModelMessage[]) => {
    if (block.length !== 2 || block[0].role !== 'assistant' || block[1].role !== 'tool'
      || !Array.isArray(block[0].content)) return undefined;
    const calls = block[0].content.filter(part => part.type === 'tool-call');
    const results = block[1].content.filter(part => part.type === 'tool-result');
    if (calls.length !== 1 || results.length !== 1 || calls[0].toolName !== 'browser'
      || results[0].toolName !== 'browser' || calls[0].toolCallId !== results[0].toolCallId) return undefined;
    const input = object(calls[0].input);
    const output = 'value' in results[0].output ? object(results[0].output.value) : undefined;
    const data = object(output?.data), execution = object(data?.executionState);
    if (input?.action !== 'code' || typeof input.reason !== 'string' || !execution
      || !Array.isArray(execution.attemptedActions) || execution.attemptedActions.length
      || !Array.isArray(execution.completedActions) || execution.completedActions.length) return undefined;
    const result = { ok: output?.ok, result: data?.result, error: data?.error, finalPage: data?.finalPage,
      attemptedActions: execution.attemptedActions, completedActions: execution.completedActions, outcome: execution.outcome };
    return createHash('sha256').update(stable([input.reason.trim().replace(/\s+/g, ' '), result])).digest('hex');
  };
  const projected: ModelMessage[][] = [];
  let previousSignature: string | undefined;
  let suppressed = 0;
  for (const block of blocks) {
    const signature = noActionSignature(block);
    if (signature && signature === previousSignature) {
      projected[projected.length - 1] = block;
      suppressed++;
    } else projected.push(block);
    previousSignature = signature;
  }
  return { messages: projected.flat(), suppressed };
}

/** Observed repetition, not a business verdict or a tool-execution veto.
 * For a no-action result, changing only the script cannot make the same
 * declared target and same returned evidence into progress. */
export function repeatedBrowserExecutionEvidence(messages: ModelMessage[]) {
  const calls = new Map<string, { name: string; input: unknown }>();
  const seen = new Set<string>();
  let run: { signature: string; kind: 'same-call' | 'same-no-action' | 'same-blocked-surface'; toolCallIds: string[]; codeHashes: string[];
    attemptedActions: unknown[]; completedActions: unknown[]; result: unknown } | undefined;
  for (const message of messages) {
    if (isOriginalBrowserChatUserMessage(message)) { run = undefined; calls.clear(); seen.clear(); }
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === 'tool-call') { calls.set(part.toolCallId, { name: part.toolName, input: part.input }); continue; }
      if (part.type !== 'tool-result' || seen.has(part.toolCallId)) continue;
      seen.add(part.toolCallId);
      const call = calls.get(part.toolCallId), input = object(call?.input);
      const output = 'value' in part.output ? object(part.output.value) : undefined;
      const data = object(output?.data), execution = object(data?.executionState);
      if (call?.name !== 'browser' || part.toolName !== call.name || input?.action !== 'code'
        || !execution || !Array.isArray(execution.attemptedActions) || !Array.isArray(execution.completedActions)) { run = undefined; continue; }
      const callInput = Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'reason' && key !== 'recoveryReview'));
      const result = { ok: output?.ok, result: data?.result, error: data?.error, finalPage: data?.finalPage,
        attemptedActions: execution.attemptedActions, completedActions: execution.completedActions, outcome: execution.outcome };
      const reason = typeof input.reason === 'string' ? input.reason.trim().replace(/\s+/g, ' ') : '';
      const noAction = execution.attemptedActions.length === 0 && execution.completedActions.length === 0
        && reason.length > 0;
      const diagnostics = object(data?.diagnostics);
      const activeSurface = object(diagnostics?.activeSurface);
      const finalPage = object(data?.finalPage);
      const blockedSurface = output?.ok === false && execution.completedActions.length === 0
        && typeof activeSurface?.id === 'string' && typeof finalPage?.url === 'string';
      const kind = blockedSurface ? 'same-blocked-surface' : noAction ? 'same-no-action' : 'same-call';
      const signature = createHash('sha256').update(stable(blockedSurface
        ? [kind, activeSurface?.id, finalPage?.url]
        : noAction ? [kind, reason, result] : [kind, callInput, result])).digest('hex');
      const previous = run?.signature === signature ? run : undefined;
      const codeHash = createHash('sha256').update(String(input.code || '')).digest('hex');
      run = { signature, kind, toolCallIds: [...(previous?.toolCallIds || []), part.toolCallId],
        codeHashes: [...new Set([...(previous?.codeHashes || []), codeHash])],
        attemptedActions: execution.attemptedActions, completedActions: execution.completedActions, result: data?.result };
    }
  }
  if (!run || run.toolCallIds.length < (run.kind === 'same-blocked-surface' ? 3 : 2)) return undefined;
  return { signature: run.signature, kind: run.kind, consecutiveCount: run.toolCallIds.length,
    distinctCodeCount: run.codeHashes.length, toolCallIds: run.toolCallIds.slice(-4),
    attemptedActions: run.attemptedActions, completedActions: run.completedActions,
    resultPreview: stable(run.result).slice(0, 1600),
    instruction: `${run.kind === 'same-blocked-surface'
      ? 'Several different actions failed without completing any browser input on the same page and active surface. This is a blocked interaction, not progress. Inspect the foreground surface stack and exact blocker. If a popup backdrop covers Cancel/Close, dismiss the foreground popup first (Escape or its observed backdrop/control), reobserve, then resolve the dialog control without relying on overlay DOM order. Do not chain the recovery after an action already known to fail.'
      : run.kind === 'same-no-action'
      ? 'The same browser target returned the same evidence without attempting browser input, even when the script changed. Script edits alone are not progress.'
      : 'The same browser code returned the same evidence repeatedly.'} Outer ok is not task success. Do not retry this target from the same assumption. Inspect the recovery DOM and current screenshot to establish the actual target and account/page identity, or contextRead to recover a previously working interaction. Then choose a different evidence-based action or record a concrete blocker and continue independent work. A bounded wait is appropriate only for an evidenced asynchronous condition. This comparison does not prove the page or business state is unchanged.` };
}

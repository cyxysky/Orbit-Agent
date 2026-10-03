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

/** Collapse only complete, consecutive, identical no-action exchanges.
 * Different scripts, assistant text or returned fields remain in context. */
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
    // Call IDs identify exchanges, not their content. Everything else must be
    // identical before deleting an exchange from the model's history.
    const comparable = block.map(message => ({ ...message,
      content: Array.isArray(message.content) ? message.content.map(part =>
        part.type === 'tool-call' || part.type === 'tool-result' ? { ...part, toolCallId: '' } : part) : message.content,
    }));
    return createHash('sha256').update(stable(comparable)).digest('hex');
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

/** Observed repetition, not a business verdict.
 * For a no-action result, changing only the script cannot make the same
 * declared target and same returned evidence into progress. */
export function repeatedBrowserExecutionEvidence(messages: ModelMessage[], records: Record<string, ModelMessage> = {}) {
  // A compression boundary must not erase the last few observed transitions.
  // Recover only a bounded recent lineage, stopping at the latest real user turn.
  const pending = [...messages], expanded: ModelMessage[] = [], visited = new Set<string>();
  let traversed = 0;
  while (pending.length && expanded.length < 120 && traversed++ < 1000) {
    const message = pending.pop()!;
    const handoff = message.role === 'user' && typeof message.content === 'string' && message.content.startsWith('[Historical handoff]\n')
      ? object(message.content.slice('[Historical handoff]\n'.length)) : undefined;
    if (handoff?.sourceAttribution === 'host-batch-lineage' && Array.isArray(handoff.sources)) {
      const refs = handoff.sources.map(source => object(source)?.ref).filter((ref): ref is string => typeof ref === 'string');
      if (refs.some(ref => !records[ref])) break;
      for (const ref of refs) if (!visited.has(ref)) { visited.add(ref); pending.push(records[ref]); }
      continue;
    }
    expanded.push(message);
    if (isOriginalBrowserChatUserMessage(message)) break;
  }
  const calls = new Map<string, { name: string; input: unknown }>();
  const seen = new Set<string>();
  let run: { signature: string; kind: 'same-call' | 'same-no-action' | 'same-blocked-surface' | 'same-observed-state' | 'repeated-state-cycle'; toolCallIds: string[]; codeHashes: string[];
    attemptedActions: unknown[]; completedActions: unknown[]; result: unknown } | undefined;
  const recent: Array<{ signature: string; id: string; codeHash: string }> = [];
  // Include both navigation and extraction receipts. A navigate/read loop has
  // no postActionState on every other call, so visual-only cycles miss it.
  const exactRecent: Array<{ signature: string; id: string; codeHash: string }> = [];
  let exactCycle: { period: number; count: number; toolCallIds: string[] } | undefined;
  let cycle: typeof run;
  let cyclePeriod: number | undefined;
  for (const message of expanded.reverse()) {
    if (isOriginalBrowserChatUserMessage(message)) {
      run = undefined; cycle = undefined; exactCycle = undefined;
      recent.length = 0; exactRecent.length = 0; calls.clear(); seen.clear();
    }
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === 'tool-call') { calls.set(part.toolCallId, { name: part.toolName, input: part.input }); continue; }
      if (part.type !== 'tool-result' || seen.has(part.toolCallId)) continue;
      seen.add(part.toolCallId);
      exactCycle = undefined;
      const call = calls.get(part.toolCallId), input = object(call?.input);
      let output = 'value' in part.output ? object(part.output.value) : undefined;
      const original = typeof output?.sourceRef === 'string' ? records[output.sourceRef] : undefined;
      const originalPart = original?.role === 'tool' ? original.content.find(item => item.type === 'tool-result' && item.toolCallId === part.toolCallId) : undefined;
      if (originalPart?.type === 'tool-result' && 'value' in originalPart.output) output = object(originalPart.output.value) || output;
      const data = object(output?.data), execution = object(data?.executionState);
      const readOnly = call?.name === 'contextRead' || call?.name === 'skill'
        || call?.name === 'file' && ['list', 'readContent', 'readSource', 'visualRead', 'visualIndex'].includes(String(input?.action))
        || call?.name === 'codeSandbox' && input?.action === 'readFile'
        || call?.name === 'browser' && (['state', 'snapshot', 'observe', 'images'].includes(String(input?.action))
          || input?.action === 'tabs' && (!input.tabOperation || input.tabOperation === 'list')
          || input?.action === 'mcp' && (input.tool === 'list' || object(data?.mcp)?.readOnly === true));
      if (readOnly) { exactRecent.length = 0; continue; }
      if (!input || call?.name !== 'browser' || part.toolName !== call.name
        || !['code', 'mcp', 'act', 'dismissSurface', 'navigate', 'tabs'].includes(String(input?.action))) {
        run = undefined; cycle = undefined; recent.length = 0; exactRecent.length = 0; continue;
      }
      const attemptedActions = Array.isArray(execution?.attemptedActions) ? execution.attemptedActions : [];
      const completedActions = Array.isArray(execution?.completedActions) ? execution.completedActions : [];
      const callInput = Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'reason' && key !== 'recoveryReview'));
      const result = { ok: output?.ok, result: data?.result, error: data?.error, finalPage: data?.finalPage,
        attemptedActions, completedActions, outcome: execution?.outcome || object(output?.actual)?.outcome || data?.outcome };
      const reason = typeof input.reason === 'string' ? input.reason.trim().replace(/\s+/g, ' ') : '';
      const noAction = input?.action === 'code' && !!execution && attemptedActions.length === 0 && completedActions.length === 0
        && reason.length > 0;
      const diagnostics = object(data?.diagnostics);
      const activeSurface = object(diagnostics?.activeSurface);
      const finalPage = object(data?.finalPage);
      const blockedSurface = output?.ok === false && completedActions.length === 0
        && typeof activeSurface?.id === 'string' && typeof finalPage?.url === 'string';
      const observation = object(data?.postActionState) || object(data?.recoveryState);
      const observed = object(observation?.data);
      const observedPage = object(observed?.activePage);
      // Epochs, capture IDs and surface metadata change on every observation.
      // Compare the returned visible view, not the script spelling or intention.
      const visibleText = typeof observed?.pageState === 'string'
        ? observed.pageState.replace(/^\[page-state\][^\n]*\n?/, '').trim() : '';
      const pixels = object(output?.browserObservation);
      const sameDomEligible = observation?.ok === true && typeof observedPage?.url === 'string' && visibleText.length > 0;
      const samePixelsEligible = pixels?.status === 'available' && typeof pixels.visualHash === 'string';
      const sameViewEligible = sameDomEligible || samePixelsEligible;
      const kind = blockedSurface ? 'same-blocked-surface' : sameViewEligible ? 'same-observed-state' : noAction ? 'same-no-action' : 'same-call';
      const signature = createHash('sha256').update(stable(blockedSurface
        ? [kind, activeSurface?.id, finalPage?.url]
        : sameDomEligible ? [kind, observedPage?.url, observedPage?.title, visibleText, observed?.truncated, data?.result]
        : samePixelsEligible ? [kind, pixels?.url, pixels?.visualHash, data?.result]
        : noAction ? [kind, reason, result] : [kind, callInput, result])).digest('hex');
      const previous = run?.signature === signature ? run : undefined;
      const codeHash = createHash('sha256').update(stable(callInput)).digest('hex');
      const exactSignature = createHash('sha256').update(stable([callInput, result,
        sameDomEligible ? [observedPage?.url, visibleText] : undefined,
      ])).digest('hex');
      exactRecent.push({ signature: exactSignature, id: part.toolCallId, codeHash });
      if (exactRecent.length > 16) exactRecent.shift();
      for (let period = 1; period <= 4; period++) {
        const tail = exactRecent.slice(-period * 3);
        if (tail.length !== period * 3
          || !tail.every((item, index) => index < period || item.signature === tail[index - period].signature)) continue;
        let count = tail.length;
        while (count < exactRecent.length
          && exactRecent[exactRecent.length - count - 1].signature === exactRecent[exactRecent.length - count - 1 + period].signature) count++;
        exactCycle = { period, count, toolCallIds: exactRecent.slice(-count).map(item => item.id) };
        break;
      }
      run = { signature, kind, toolCallIds: [...(previous?.toolCallIds || []), part.toolCallId],
        codeHashes: [...new Set([...(previous?.codeHashes || []), codeHash])],
        attemptedActions, completedActions, result: data?.result };
      cycle = undefined;
      cyclePeriod = undefined;
      if (!sameViewEligible) { recent.length = 0; continue; }
      recent.push({ signature, id: part.toolCallId, codeHash });
      if (recent.length > 12) recent.shift();
      for (let period = 2; period <= 4; period++) {
        const tail = recent.slice(-period * 3);
        if (tail.length !== period * 3 || new Set(tail.map(item => item.signature)).size < 2
          || !tail.every((item, index) => index < period || item.signature === tail[index - period].signature)) continue;
        cyclePeriod = period;
        cycle = { ...run, kind: 'repeated-state-cycle', signature: createHash('sha256').update(stable(tail.map(item => item.signature))).digest('hex'),
          toolCallIds: tail.map(item => item.id), codeHashes: [...new Set(tail.map(item => item.codeHash))] };
        break;
      }
    }
  }
  if (cycle) run = cycle;
  if (exactCycle && run) {
    run = { ...run, kind: exactCycle.period === 1 ? 'same-call' : 'repeated-state-cycle',
      toolCallIds: exactCycle.toolCallIds,
      codeHashes: [...new Set(exactRecent.slice(-exactCycle.count).map(item => item.codeHash))] };
    cyclePeriod = exactCycle.period;
  }
  if (!run || run.toolCallIds.length < (run.kind === 'same-blocked-surface' || run.kind === 'same-observed-state' ? 3 : 2)) return undefined;
  return { signature: run.signature, kind: run.kind, consecutiveCount: run.toolCallIds.length,
    ...(cycle || exactCycle ? { cyclePeriod } : {}),
    // Three cycles get a recovery advisory; the fourth ends tool execution.
    // Never end work merely because the screenshot stayed the same.
    requiresFinalization: Boolean(exactCycle && exactCycle.count >= exactCycle.period * 4),
    distinctCodeCount: run.codeHashes.length, toolCallIds: run.toolCallIds.slice(-4),
    attemptedActions: run.attemptedActions, completedActions: run.completedActions,
    resultPreview: stable(run.result).slice(0, 1600),
    instruction: `${run.kind === 'repeated-state-cycle'
      ? 'Browser observations repeatedly alternate through the same small sequence of states. Toggling a menu/dialog or switching pages back and forth can be a loop even when consecutive screenshots differ. Verify whether the requested result actually advanced; choose a changed action based on the current state. Do not stop authorized work solely because this advisory fired.'
      : run.kind === 'same-blocked-surface'
      ? 'Several different actions failed without completing any browser input on the same page and active surface. This is a blocked interaction, not progress. Inspect the foreground surface stack and exact blocker. If a popup covers Cancel/Close, use browser action=dismissSurface to click viewport (0,0), or its observed close control, then inspect the returned state before resolving the dialog control. Do not rely on overlay DOM order or chain recovery after an action already known to fail.'
      : run.kind === 'same-no-action'
      ? 'The same browser target returned the same evidence without attempting browser input, even when the script changed. Script edits alone are not progress.'
      : run.kind === 'same-observed-state'
      ? 'Several browser cells returned the same visible page state and result despite different scripts or intentions. Check the actual account, destination, form, date range and active filters before another dependent action. A bounded view may omit a real change; retrieve the specific missing evidence instead of assuming either success or absence.'
      : 'The same browser code returned the same evidence repeatedly.'} For read-only research, use the returned data.result as evidence; a successful read does not need a click or a visible page change. If output was shortened, use contextRead with its archived ref and omitted pointer instead of rerunning extraction. Outer ok alone is not task success. Do not retry this target from the same assumption. Resolve a specific missing fact with a different source or query, or summarize the verified findings and remaining gaps. For page interactions, inspect the recovery DOM and current screenshot before changing the action. A bounded wait is appropriate only for an evidenced asynchronous condition. This comparison does not prove the page or business state is unchanged.` };
}

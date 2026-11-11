import type {
  BrowserChatAiOutputCycle,
  BrowserChatAiOutputTool,
  StepExecutionResult,
} from '@/server/ai/schemas/runtime.schema';


export {
  browserChatAiOutputViewFromResponse as aiOutputViewFromResponse,
  hasAiOutputView,
  stringFromUnknown,
} from '@/lib/browser-chat-output-cycles';

type BrowserChatToolCall = NonNullable<StepExecutionResult['tools']>[number];

export type BrowserChatToolDetail = {
  confirmationScreenshotUrl?: string;
  subagentId?: string;
  parentMessageId?: string;
  stepIndex: number;
  step: StepExecutionResult;
  toolIndex: number;
  tool: BrowserChatToolCall;
};

/** Retain fetched evidence unless a newer explicit outcome invalidates it. */
export function mergeBrowserChatToolDetail(detail: BrowserChatToolDetail, live: BrowserChatToolDetail): BrowserChatToolDetail {
  const outcomeChanged = detail.tool.ok !== undefined && live.tool.ok !== undefined && live.tool.ok !== detail.tool.ok;
  return {
    ...detail,
    ...live,
    confirmationScreenshotUrl: live.confirmationScreenshotUrl ?? detail.confirmationScreenshotUrl,
    tool: {
      ...detail.tool,
      ...live.tool,
      startedAt: detail.tool.startedAt ?? live.tool.startedAt,
      input: detail.tool.input ?? live.tool.input,
      elapsedMs: detail.tool.elapsedMs === undefined ? live.tool.elapsedMs : Math.max(detail.tool.elapsedMs, live.tool.elapsedMs ?? 0),
      aiRequestElapsedMs: detail.tool.aiRequestElapsedMs === undefined ? live.tool.aiRequestElapsedMs : Math.max(detail.tool.aiRequestElapsedMs, live.tool.aiRequestElapsedMs ?? 0),
      ok: live.tool.ok ?? detail.tool.ok,
      rawResult: outcomeChanged ? live.tool.rawResult : detail.tool.rawResult ?? live.tool.rawResult,
      contentSource: detail.tool.contentSource ?? live.tool.contentSource,
      result: outcomeChanged ? live.tool.result : detail.tool.result ?? live.tool.result,
      error: (live.tool.ok ?? detail.tool.ok) === true ? undefined
        : outcomeChanged ? live.tool.error : detail.tool.error ?? live.tool.error,
      contextAfter: live.tool.contextAfter?.requestId ? live.tool.contextAfter
        : detail.tool.contextAfter?.requestId ? detail.tool.contextAfter
          : live.tool.contextAfter ?? detail.tool.contextAfter,
    },
  };
}

export function aiCycleToolKey(cycleId: string, toolIndex: number) {
  return `${cycleId}:${toolIndex}`;
}

export function toolInputSignature(value: unknown) {
  const canonicalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonicalize);
    if (!input || typeof input !== 'object') return input;
    const record = input as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record)
      .filter((key) => key !== 'reason' && key !== 'requiresConfirmation' && key !== 'confirmationMessage')
      .sort()
      .map((key) => [key, canonicalize(record[key])]));
  };
  try {
    return JSON.stringify(canonicalize(value)) || '';
  } catch {
    return '';
  }
}

export function buildAiCycleToolDetailMap(cycles: BrowserChatAiOutputCycle[], steps: StepExecutionResult[], running = false) {
  const details = new Map<string, BrowserChatToolDetail>();
  const persistedToolsById = new Map<string, BrowserChatToolDetail[]>();
  const persistedTools: BrowserChatToolDetail[] = [];
  const consumedPersistedTools = new Set<BrowserChatToolDetail>();
  const consumedProviderResultIds = new Set<string>();

  steps.forEach((step) => {
    (step.tools || []).forEach((tool, toolIndex) => {
      const detail = {
        stepIndex: step.index,
        step,
        toolIndex,
        tool,
      };
      if (tool.id) {
        const matches = persistedToolsById.get(tool.id) || [];
        matches.push(detail);
        persistedToolsById.set(tool.id, matches);
      }
      persistedTools.push(detail);
    });
  });

  cycles.forEach((cycle) => {
    const unmatched: Array<{ aiTool: BrowserChatAiOutputTool; aiToolIndex: number }> = [];
    cycle.output.tools.forEach((aiTool, aiToolIndex) => {
      const belongsToCycle = (candidate: BrowserChatToolDetail) => (
        candidate.tool.name === aiTool.name
        && (typeof cycle.stepIndex !== 'number' || candidate.stepIndex === cycle.stepIndex)
      );
      const idMatches = aiTool.id ? persistedToolsById.get(aiTool.id) : undefined;
      const legacyCompression = aiTool.name === 'contextCompression'
        && aiTool.id === (cycle.sourceCycleId || cycle.id);
      // Old completion events used their cycle ID instead of the execution ID.
      // Pair each with its completed trace; separate compression runs stay separate.
      const legacyMatches = legacyCompression ? persistedTools.filter((candidate) => (
        belongsToCycle(candidate) && candidate.tool.ok === true
        && (!cycle.messageId || candidate.step.messageId === cycle.messageId)
      )) : [];
      const detail = idMatches
        ? [...idMatches].sort((left, right) => {
          const score = (candidate: BrowserChatToolDetail) => (
            (candidate.tool.rawResult !== undefined ? 8 : 0)
            + (candidate.tool.result !== undefined ? 4 : 0)
            + (candidate.tool.ok !== undefined ? 2 : 0)
          );
          return score(right) - score(left);
        }).find((candidate) => (
          !consumedPersistedTools.has(candidate) && belongsToCycle(candidate)
        ))
        : legacyMatches.find((candidate) => !consumedPersistedTools.has(candidate));
      if (detail) {
        details.set(aiCycleToolKey(cycle.id, aiToolIndex), detail);
        consumedPersistedTools.add(detail);
        return;
      }
      if (idMatches?.length) return;
      if (aiTool.ok !== undefined) {
        const providerResultId = `${cycle.stepIndex ?? 'unknown'}:${aiTool.id || `${cycle.id}:${aiToolIndex}`}`;
        if (consumedProviderResultIds.has(providerResultId)) return;
        consumedProviderResultIds.add(providerResultId);
        const tool: BrowserChatToolCall = {
          id: aiTool.id || `${cycle.id}:${aiToolIndex}`,
          input: aiTool.input,
          name: aiTool.name,
          reason: aiTool.reason,
          ok: aiTool.ok,
          result: aiTool.result,
          rawResult: aiTool.rawResult,
          contentSource: aiTool.contentSource,
          ...(aiTool.ok ? {} : { error: aiTool.error || aiTool.result }),
        };
        const stepIndex = typeof cycle.stepIndex === 'number' ? cycle.stepIndex : -1;
        const step: StepExecutionResult = {
          index: stepIndex,
          messageId: cycle.messageId,
          action: aiTool.name,
          expected: 'Tool execution result',
          actual: aiTool.result || (aiTool.ok ? 'Tool completed.' : 'Tool failed.'),
          status: aiTool.ok ? 'passed' : 'failed',
          tools: [tool],
        };
        details.set(aiCycleToolKey(cycle.id, aiToolIndex), { stepIndex, step, toolIndex: -1, tool });
        return;
      }
      unmatched.push({ aiTool, aiToolIndex });
    });

    unmatched.forEach(({ aiTool, aiToolIndex }) => {
      if (!aiTool.invalid && !running) return;
      const stepIndex = typeof cycle.stepIndex === 'number' ? cycle.stepIndex : -1;
      const parseError = aiTool.invalid ? aiTool.error || '工具参数解析失败' : undefined;
      // Later model output is not a tool receipt. A batch can contain several
      // calls queued behind one another, and trace events may arrive separately.
      const projectedTool: BrowserChatToolCall = {
        id: aiTool.id || `${cycle.id}:${aiToolIndex}`,
        name: aiTool.name,
        input: aiTool.input,
        reason: aiTool.reason,
        invalid: aiTool.invalid,
        error: parseError,
        ok: aiTool.invalid ? false : undefined,
        result: parseError,
      };
      const projectedStep: StepExecutionResult = {
        index: stepIndex,
        messageId: cycle.messageId,
        action: aiTool.name,
        expected: aiTool.invalid ? '有效的工具参数' : '工具执行结果',
        actual: parseError || '等待工具执行',
        status: aiTool.invalid ? 'failed' : 'queued',
        tools: [projectedTool],
      };
      details.set(aiCycleToolKey(cycle.id, aiToolIndex), {
        stepIndex,
        step: projectedStep,
        toolIndex: -1,
        tool: projectedTool,
      });
    });
  });

  return details;
}

/** Project every persisted call into the same ordered stream as model output. */
export function buildBrowserChatToolTimeline(
  cycles: BrowserChatAiOutputCycle[],
  steps: StepExecutionResult[],
  options: {
    messageId: string;
    running: boolean;
    logs: readonly { time: string; toolCallId?: string; stepIndex?: number }[];
  },
) {
  const toolDetails = buildAiCycleToolDetailMap(cycles, steps, options.running);
  const providerCycles = cycles.filter(cycle => !cycle.sourceCycleId
    || cycle.output.tools.some((_tool, index) => toolDetails.has(aiCycleToolKey(cycle.id, index))));
  const represented = new Map<string, number>();
  const cycleTimes = providerCycles.map(cycle => Date.parse(cycle.createdAt || ''));
  providerCycles.forEach((cycle, cycleIndex) => {
    cycle.output.tools.forEach((_tool, toolIndex) => {
      const detail = toolDetails.get(aiCycleToolKey(cycle.id, toolIndex));
      if (detail && detail.toolIndex >= 0) represented.set(`${detail.stepIndex}:${detail.toolIndex}`, cycleIndex);
    });
  });
  const dispatchTimes = new Map<string, number>();
  for (const log of options.logs) {
    const time = Date.parse(log.time);
    if (!log.toolCallId || !Number.isFinite(time)) continue;
    dispatchTimes.set(log.toolCallId, Math.min(dispatchTimes.get(log.toolCallId) ?? time, time));
  }
  const insertions = new Map<number, BrowserChatAiOutputCycle[]>();
  for (const step of [...steps].sort((left, right) => left.index - right.index)) {
    const tools = step.tools || [];
    const stepIndexes = providerCycles.flatMap((cycle, index) => cycle.stepIndex === step.index ? [index] : []);
    const followingStep = providerCycles.findIndex(cycle => typeof cycle.stepIndex === 'number' && cycle.stepIndex > step.index);
    const first = stepIndexes[0] ?? (followingStep < 0 ? providerCycles.length : followingStep);
    const end = stepIndexes.length ? stepIndexes[stepIndexes.length - 1] + 1 : first;
    const followingAnchors: Array<number | undefined> = [];
    let following: number | undefined;
    for (let index = tools.length - 1; index >= 0; index -= 1) {
      followingAnchors[index] = following;
      following = represented.get(`${step.index}:${index}`) ?? following;
    }
    let previous: number | undefined;
    let lastPosition = first;
    tools.forEach((tool, toolIndex) => {
      const anchor = represented.get(`${step.index}:${toolIndex}`);
      if (anchor !== undefined) { previous = anchor; return; }
      const next = followingAnchors[toolIndex];
      const startedAt = Date.parse(tool.startedAt || '');
      const time = Number.isFinite(startedAt) ? startedAt : tool.id ? dispatchTimes.get(tool.id) : undefined;
      let position = next ?? (previous !== undefined ? previous + 1 : first);
      if (time !== undefined) {
        const after = stepIndexes.find(index => Number.isFinite(cycleTimes[index]) && cycleTimes[index] > time);
        position = after ?? end;
      }
      // Call order bounds late/missing log timestamps without moving model text.
      const lower = previous !== undefined ? previous + 1 : first;
      const upper = next ?? end;
      position = Math.max(lastPosition, Math.min(Math.max(position, lower), upper));
      lastPosition = position;
      const id = `persisted-step-${options.messageId}-${step.index}-${toolIndex}`;
      const cycle: BrowserChatAiOutputCycle = {
        id,
        messageId: step.messageId || options.messageId,
        stepIndex: step.index,
        createdAt: time !== undefined ? new Date(time).toISOString() : undefined,
        output: { parts: [{ kind: 'tool', index: 0 }], texts: [], reasoning: [],
          tools: [{ id: tool.id || id, name: tool.name, input: tool.input }] },
      };
      const bucket = insertions.get(position) || [];
      bucket.push(cycle);
      insertions.set(position, bucket);
      toolDetails.set(aiCycleToolKey(id, 0), { step, stepIndex: step.index, tool, toolIndex });
    });
  }
  const ordered: BrowserChatAiOutputCycle[] = [];
  for (let index = 0; index <= providerCycles.length; index += 1) {
    ordered.push(...(insertions.get(index) || []));
    if (index < providerCycles.length) ordered.push(providerCycles[index]);
  }
  return { cycles: ordered, toolDetails };
}

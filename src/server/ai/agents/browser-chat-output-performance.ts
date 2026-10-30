import type { BrowserChatOutputPerformance } from '@/lib/browser-chat-activity';
import { asRecord } from '@/lib/unknown-value';
import { estimateRuntimeTextTokens } from './runtime-context-budget';

type ModelCallPerformance = {
  responseTimeMs: number;
  outputTokensPerSecond?: number;
  timeToFirstOutputMs?: number;
};

function nonNegativeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function positiveNumber(value: unknown) {
  const number = nonNegativeNumber(value);
  return number !== undefined && number > 0 ? number : undefined;
}

/** Count every output channel, including reasoning and streamed tool arguments. */
export function createBrowserChatOutputPerformance(startedAt: number) {
  let estimatedTokenUnits = 0;
  let firstOutputAt: number | undefined;
  let lastOutputAt: number | undefined;
  const record = (text: string, timestamp = Date.now()) => {
    if (!text) return;
    firstOutputAt ??= timestamp;
    lastOutputAt = timestamp;
    // Do not round each packet: splitting a token into several packets must
    // not inflate the estimate. Match the existing runtime token estimator.
    for (const char of text) estimatedTokenUnits += char.charCodeAt(0) <= 0x7f ? 0.25 : 1;
  };
  const snapshot = (timestamp = Date.now()): BrowserChatOutputPerformance => {
    const outputDurationMs = firstOutputAt === undefined ? 0 : Math.max(0, timestamp - firstOutputAt);
    const outputTokens = Math.ceil(estimatedTokenUnits);
    return {
      outputTokens,
      // A first packet has no measurable generation interval yet.
      outputTokensPerSecond: outputDurationMs >= 500 && outputTokens > 0
        ? outputTokens * 1000 / outputDurationMs : undefined,
      outputDurationMs,
      timeToFirstOutputMs: firstOutputAt === undefined ? undefined : Math.max(0, firstOutputAt - startedAt),
      estimated: true,
    };
  };
  const finish = (event: { usage?: unknown; performance: ModelCallPerformance; content?: ReadonlyArray<unknown> }): BrowserChatOutputPerformance => {
    const usage = asRecord(event.usage);
    const reportedOutputTokens = nonNegativeNumber(usage?.outputTokens)
      ?? nonNegativeNumber(asRecord(usage?.outputTokens)?.total);
    // Completion callbacks can await persistence before reaching this helper.
    // End a locally observed interval at the last output, not after those writes.
    const current = snapshot(lastOutputAt);
    const sdkFirstOutputMs = nonNegativeNumber(event.performance.timeToFirstOutputMs);
    const timeToFirstOutputMs = sdkFirstOutputMs ?? current.timeToFirstOutputMs;
    const responseTimeMs = positiveNumber(event.performance.responseTimeMs);
    // SDK timings share one origin. Never subtract our pre-dispatch TTFO from
    // the SDK's response time: lazy setup/debug writes can make that negative.
    const sdkOutputDurationMs = responseTimeMs !== undefined && sdkFirstOutputMs !== undefined
      ? positiveNumber(responseTimeMs - sdkFirstOutputMs) : undefined;
    const observedOutputDurationMs = positiveNumber(current.outputDurationMs);
    const outputDurationMs = sdkOutputDurationMs ?? observedOutputDurationMs ?? responseTimeMs ?? 0;
    const includesFirstOutputWait = sdkOutputDurationMs === undefined && observedOutputDurationMs === undefined
      && responseTimeMs !== undefined;
    const fallbackText = estimatedTokenUnits > 0 ? '' : (event.content || []).flatMap(part => {
      const item = asRecord(part);
      if (item?.type === 'text' || item?.type === 'reasoning') return typeof item.text === 'string' ? [item.text] : [];
      if (item?.type === 'tool-call') return [JSON.stringify(item.input) || ''];
      return [];
    }).join('');
    const estimatedOutputTokens = current.outputTokens || estimateRuntimeTextTokens(fallbackText);
    // Some compatible endpoints report zero usage despite returning content.
    // Zero then means unavailable accounting, rather than zero generation.
    const hasReportedTokens = reportedOutputTokens !== undefined
      && (reportedOutputTokens > 0 || estimatedOutputTokens === 0);
    const outputTokens = hasReportedTokens ? reportedOutputTokens : estimatedOutputTokens;
    return {
      outputTokens,
      // The SDK also uses zero as its sentinel for an unknown/zero interval.
      // Recompute from usable timing instead of allowing that sentinel to win.
      outputTokensPerSecond: outputTokens > 0 && outputDurationMs > 0
        ? outputTokens * 1000 / outputDurationMs : undefined,
      outputDurationMs,
      timeToFirstOutputMs,
      ...(includesFirstOutputWait ? { includesFirstOutputWait: true } : {}),
      estimated: !hasReportedTokens || sdkOutputDurationMs === undefined,
    };
  };
  return { record, snapshot, finish };
}

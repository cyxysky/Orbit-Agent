'use client';

import { type CSSProperties, useMemo, useRef, useState } from 'react';
import { InputGroup } from '@heroui/react/input-group';
import { ChevronRight, Copy, Search, X } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { BrowserChatPayloadDetails } from '@/components/BrowserChatPayloadDetails';
import {
  isBrowserChatAiFailureLog,
  isBrowserChatAiLog,
  isBrowserChatAiTerminalFailureLog,
  isBrowserChatContextCompressionLog,
  isBrowserChatDocumentVisualQaLog,
  isBrowserChatScreenshotPerformanceLog,
  isBrowserChatToolLifecycleLog,
  summarizeBrowserChatExecutionTotals,
  summarizeBrowserChatLogs,
} from '@/components/browser-chat-log-model';
import { formatLogTime, formatToolPayload, parseJsonObjectText, phaseLabel } from '@/lib/browser-chat-format';
import { useI18n } from '@/i18n/I18nProvider';
import { asRecord, finiteNumber } from '@/lib/unknown-value';
import { AppModal } from '@/components/ui/app-modal';

type Translator = ReturnType<typeof useI18n>['t'];
type BrowserChatLogFilter = 'all' | 'ai' | 'tool' | 'context' | 'screenshot';
type BrowserChatLogStatus = 'completed' | 'failed' | 'running';

export type BrowserChatLogDialogRecord = {
  details?: string;
  elapsedMs?: number;
  id: string;
  message: string;
  phase: string;
  stepIndex?: number;
  time: string;
};

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function booleanValue(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

function aiLogRequestPayload(details?: Record<string, unknown>) {
  if (!details) return '';
  const value = details.aiInput !== undefined ? details.aiInput : details;
  return value === undefined ? '' : formatToolPayload(value);
}

function aiLogResponsePayload(details?: Record<string, unknown>) {
  if (!details) return '';
  // Older oversized responses contain only a truncation envelope and preview.
  // Keep that evidence visible even though the aiOutput structure is missing.
  return formatToolPayload(details.aiOutput ?? details);
}

function aiLogPayloadDetails(details?: Record<string, unknown>) {
  return asRecord(details?.event) || asRecord(details?.value) || details;
}

function estimatedAiInputTokens(details?: Record<string, unknown>) {
  const stats = asRecord(details?.aiInputTokens);
  const exact = finiteNumber(stats?.estimatedTotalTokens) ?? finiteNumber(stats?.estimatedTextTokens);
  if (exact !== undefined) return exact;
  if (details?.aiInput === undefined) return undefined;
  try {
    const serialized = JSON.stringify(details.aiInput);
    const imageCount = finiteNumber(asRecord(asRecord(details.aiInput)?.options)?.imageCount) || 0;
    return Math.ceil(serialized.length / 4) + imageCount * 1_024;
  } catch {
    return undefined;
  }
}

function aiLogInputTokenCount(log: BrowserChatLogDialogRecord) {
  if (!log.phase.endsWith('ai:runtime:request')) return undefined;
  const details = parseJsonObjectText(log.details);
  return estimatedAiInputTokens(aiLogPayloadDetails(details));
}

function aiLogTimings(details?: Record<string, unknown>) {
  return asRecord(asRecord(details?.aiOutput)?.timings);
}

function formatElapsedMs(value: unknown) {
  const elapsedMs = finiteNumber(value);
  return elapsedMs === undefined ? undefined : `${Math.round(elapsedMs)}ms`;
}

function formatTotalElapsedMs(value: number) {
  if (value < 1_000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(value < 10_000 ? 2 : 1).replace(/\.0+$/, '')}s`;
  const totalSeconds = Math.round(value / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function phaseMatches(log: BrowserChatLogDialogRecord, phase: string) {
  return log.phase === phase || log.phase.endsWith(`:${phase}`);
}

function isAiAttemptStartLog(log: BrowserChatLogDialogRecord) {
  return phaseMatches(log, 'ai:runtime:attempt');
}

function isTerminalFailureLog(log: BrowserChatLogDialogRecord) {
  return isBrowserChatAiTerminalFailureLog(log)
    || phaseMatches(log, 'ai:runtime:retry-exhausted')
    || phaseMatches(log, 'ai:runtime:error')
    || phaseMatches(log, 'chat:runtime:request-aborted')
    || phaseMatches(log, 'target:plan:validation:error')
    || phaseMatches(log, 'target:plan:error');
}

function browserChatLogStatus(logs: BrowserChatLogDialogRecord[]): BrowserChatLogStatus {
  let status: BrowserChatLogStatus = 'running';
  for (const log of logs) {
    if (isTerminalFailureLog(log)) status = 'failed';
    else if (isAiAttemptStartLog(log) || phaseMatches(log, 'ai:runtime:prepare')
      || phaseMatches(log, 'ai:context-compression:start') || phaseMatches(log, 'chat:run:start')) status = 'running';
    else if (phaseMatches(log, 'ai:runtime:attempt-succeeded')
      || phaseMatches(log, 'ai:runtime:response') || phaseMatches(log, 'ai:runtime:object')
      || phaseMatches(log, 'chat:ai-response-finished') || phaseMatches(log, 'chat:no-tool-response')
      || phaseMatches(log, 'chat:run:done')) status = 'completed';
  }
  return status;
}

function browserChatLogStatusLabel(status: BrowserChatLogStatus) {
  if (status === 'failed') return '失败';
  if (status === 'running') return '执行中';
  return '已完成';
}

function browserChatLogMatchesFilter(log: BrowserChatLogDialogRecord, filter: BrowserChatLogFilter) {
  if (filter === 'ai') return isBrowserChatAiLog(log);
  if (filter === 'tool') return isBrowserChatToolLifecycleLog(log);
  if (filter === 'context') return isBrowserChatContextCompressionLog(log);
  if (filter === 'screenshot') return isBrowserChatScreenshotPerformanceLog(log);
  return true;
}

function browserChatLogEventTitle(log: BrowserChatLogDialogRecord) {
  if (isBrowserChatAiFailureLog(log)) return 'AI 请求异常';
  if (phaseMatches(log, 'ai:runtime:attempt')) return 'AI 请求已开始';
  if (phaseMatches(log, 'ai:runtime:request')) return '等待 AI 首包';
  if (phaseMatches(log, 'ai:runtime:response-headers')) return '已建立 AI 响应流';
  if (phaseMatches(log, 'ai:runtime:receiving')) return '正在接收 AI 响应';
  if (phaseMatches(log, 'ai:runtime:response') || phaseMatches(log, 'ai:runtime:object')) return '模型已返回';
  if (phaseMatches(log, 'ai:runtime:attempt-succeeded')) return 'AI 请求正常结束';
  if (isBrowserChatDocumentVisualQaLog(log)) return '文档视觉质检';
  if (isBrowserChatToolLifecycleLog(log)) return '工具调用';
  if (isBrowserChatContextCompressionLog(log)) return contextCompressionLabel(log) || '上下文';
  if (isBrowserChatScreenshotPerformanceLog(log)) return '截图性能';
  return phaseLabel(log.phase);
}

function browserChatLogTone(log: BrowserChatLogDialogRecord) {
  if (isTerminalFailureLog(log) || isBrowserChatAiFailureLog(log)) return 'danger';
  if (phaseMatches(log, 'ai:runtime:attempt-succeeded')) return 'success';
  if (isBrowserChatToolLifecycleLog(log)) return 'tool';
  if (isBrowserChatContextCompressionLog(log)) return 'context';
  if (isBrowserChatScreenshotPerformanceLog(log)) return 'screenshot';
  return 'ai';
}

function formatPostprocessTimings(value: unknown) {
  const timings = asRecord(value);
  if (!timings) return '';
  const fields = [
    'desktopBeforeMs',
    'desktopAfterMs',
    'notifyStartMs',
    'notifyResultMs',
    'visualContextMs',
    'notifyCompleteMs',
  ];
  return fields
    .map((field) => {
      const elapsed = formatElapsedMs(timings[field]);
      return elapsed ? `${field} ${elapsed}` : '';
    })
    .filter(Boolean)
    .join('，');
}

function aiLogTimingInline(log: BrowserChatLogDialogRecord, t: Translator) {
  if (log.phase !== 'ai:runtime:response' && log.phase !== 'ai:runtime:object') return '';
  const parsed = parseJsonObjectText(log.details);
  const timings = aiLogTimings(parsed);
  if (!timings) return '';
  const ai = formatElapsedMs(timings.aiRequestElapsedMs);
  const tool = formatElapsedMs(timings.toolElapsedMs);
  const overhead = formatElapsedMs(timings.toolOverheadElapsedMs);
  const total = formatElapsedMs(timings.totalElapsedMs);
  return [
    ai ? `AI ${ai}` : '',
    tool ? t('工具 {time}', { time: tool }) : '',
    overhead && overhead !== '0ms' ? t('后处理 {time}', { time: overhead }) : '',
    total ? t('总计 {time}', { time: total }) : '',
  ].filter(Boolean).join(' · ');
}

function aiLogTimingPayload(details: Record<string, unknown> | undefined, t: Translator) {
  const timings = aiLogTimings(details);
  if (!timings) return '';
  const lines: string[] = [];
  const total = formatElapsedMs(timings.totalElapsedMs);
  if (total) lines.push(t('总耗时：{time}', { time: total }));
  const ai = formatElapsedMs(timings.aiRequestElapsedMs);
  if (ai) lines.push(t('AI 请求耗时：{time}', { time: ai }));
  const tool = formatElapsedMs(timings.toolElapsedMs);
  if (tool) lines.push(t('工具动作耗时：{time}', { time: tool }));
  const overhead = formatElapsedMs(timings.toolOverheadElapsedMs);
  if (overhead && overhead !== '0ms') lines.push(t('工具后处理耗时：{time}', { time: overhead }));
  const other = formatElapsedMs(timings.otherElapsedMs);
  if (other && other !== '0ms') lines.push(t('其他耗时：{time}', { time: other }));
  const toolCount = finiteNumber(timings.toolCount);
  if (toolCount !== undefined) lines.push(t('工具数量：{count}', { count: toolCount }));
  const tools = Array.isArray(timings.tools) ? timings.tools : [];
  if (tools.length) {
    lines.push(t('工具明细：'));
    tools.forEach((toolItem, index) => {
      const record = asRecord(toolItem);
      if (!record) return;
      const name = stringValue(record.name) || `tool ${index + 1}`;
      const action = formatElapsedMs(record.actionElapsedMs) || formatElapsedMs(record.elapsedMs) || '-';
      const overhead = formatElapsedMs(record.overheadElapsedMs);
      const total = formatElapsedMs(record.traceElapsedMs);
      const parts = [t('动作 {time}', { time: action })];
      if (overhead && overhead !== '0ms') parts.push(t('后处理 {time}', { time: overhead }));
      if (total && total !== action) parts.push(t('总计 {time}', { time: total }));
      const postprocess = formatPostprocessTimings(record.postprocessTimings);
      if (postprocess) parts.push(t('明细 {details}', { details: postprocess }));
      lines.push(`  ${index + 1}. ${name}: ${parts.join('，')}`);
    });
  }
  return lines.join('\n');
}

function contextCompressionLabel(log: BrowserChatLogDialogRecord) {
  if (!isBrowserChatContextCompressionLog(log)) return '';
  if (log.phase.endsWith('ai:context-compression:start')) return '上下文开始压缩';
  if (log.phase.endsWith('ai:context-compression:progress')) return '上下文压缩进度';
  if (log.phase.endsWith('ai:context-compression:retry')) return '上下文摘要重试';
  if (log.phase.endsWith('ai:context-compression:partial')) return '上下文压缩部分完成';
  if (log.phase.endsWith('ai:context-compression:limited')) return '上下文压缩已保存（继续执行）';
  if (log.phase.endsWith('ai:context-compression:skipped')) return '上下文压缩已跳过（此前批次失败）';
  if (log.phase.endsWith('ai:context-compression:error')) return '上下文压缩失败';
  if (log.phase.endsWith('ai:context-compression:complete')) return '上下文压缩完成';
  if (log.phase.endsWith('ai:context-segmented')) return 'Agent Loop 上下文压缩';
  if (log.phase.endsWith('conversation:context:request')) return '上下文摘要模型请求';
  if (log.phase.endsWith('conversation:context:response')) return '上下文摘要模型已返回';
  if (log.phase.endsWith('conversation:context:error')) return '上下文摘要模型请求失败';
  return '';
}

function formatScreenshotTimingStep(step: unknown, index: number) {
  const record = asRecord(step);
  if (!record) return '';
  const name = stringValue(record.name) || `step ${index + 1}`;
  const elapsedMs = finiteNumber(record.elapsedMs);
  const parts = [`${index + 1}. ${name}`];
  if (elapsedMs !== undefined) parts.push(`${elapsedMs}ms`);
  const count = finiteNumber(record.count);
  if (count !== undefined) parts.push(`count=${count}`);
  if (booleanValue(record.skipped)) parts.push('skipped');
  const path = stringValue(record.path);
  if (path) parts.push(`path=${path}`);
  const error = stringValue(record.error);
  if (error) parts.push(`error=${error}`);
  return parts.join(' | ');
}

function screenshotPerformancePayload(details: Record<string, unknown>) {
  const timings = asRecord(details.timings);
  const lines: string[] = [];
  const totalMs = finiteNumber(timings?.totalMs) ?? finiteNumber(details.elapsedMs);
  if (totalMs !== undefined) lines.push(`totalMs: ${totalMs}`);
  const capture = stringValue(timings?.capture);
  if (capture) lines.push(`capture: ${capture}`);
  const path = stringValue(timings?.path) || stringValue(details.path) || stringValue(details.screenshotPath);
  if (path) lines.push(`path: ${path}`);
  const markerPath = stringValue(timings?.markerPath);
  if (markerPath) lines.push(`markerPath: ${markerPath}`);
  const originalPath = stringValue(timings?.originalPath);
  if (originalPath) lines.push(`originalPath: ${originalPath}`);
  const candidateCount = finiteNumber(timings?.candidateCount);
  if (candidateCount !== undefined) lines.push(`candidateCount: ${candidateCount}`);
  const scrollAreaCount = finiteNumber(timings?.scrollAreaCount);
  if (scrollAreaCount !== undefined) lines.push(`scrollAreaCount: ${scrollAreaCount}`);
  const separateMarkerMap = booleanValue(timings?.separateMarkerMap);
  if (separateMarkerMap !== undefined) lines.push(`separateMarkerMap: ${separateMarkerMap}`);
  const rawSteps = timings?.steps;
  const steps = Array.isArray(rawSteps)
    ? rawSteps.map(formatScreenshotTimingStep).filter(Boolean)
    : [];
  if (steps.length) {
    lines.push('steps:');
    lines.push(...steps.map((step) => `  ${step}`));
  }
  return lines.join('\n');
}

function BrowserChatLogDetails({ expanded, log, nextAiInputTokens }: { expanded: boolean; log: BrowserChatLogDialogRecord; nextAiInputTokens?: number }) {
  const { t } = useI18n();
  if (!expanded || !log.details) return null;
  const parsed = parseJsonObjectText(log.details);
  const isAiRequestLog = log.phase.endsWith('ai:runtime:request');
  const isAiResponseLog = log.phase.endsWith('ai:runtime:response') || log.phase.endsWith('ai:runtime:object');
  const isAiFailureLog = isBrowserChatAiFailureLog(log);
  const isToolLifecycleLog = isBrowserChatToolLifecycleLog(log);
  const isConversationSummaryRequest = phaseMatches(log, 'conversation:context:request');
  const isConversationSummaryResponse = phaseMatches(log, 'conversation:context:response');
  if (!parsed) return (
    <div className="browser-chat-log-details">
      <BrowserChatPayloadDetails className="browser-chat-log-detail-block" defaultOpen payload={log.details} title={t('日志详情')} />
    </div>
  );
  const payloadDetails = aiLogPayloadDetails(parsed) || parsed;
  const requestPayload = isAiRequestLog || isConversationSummaryRequest
    ? aiLogRequestPayload(payloadDetails)
    : '';
  const responsePayload = isAiResponseLog
    ? aiLogResponsePayload(payloadDetails)
    : isConversationSummaryResponse
      ? formatToolPayload(payloadDetails)
      : '';
  const timingPayload = isAiResponseLog ? aiLogTimingPayload(payloadDetails, t) : '';
  const errorPayload = isAiFailureLog ? formatToolPayload(parsed) : '';
  // Tool lifecycle logs are diagnostics. Render the persisted payload verbatim
  // instead of selecting only execution/trace or normalizing nested JSON.
  const toolPayload = isToolLifecycleLog ? log.details : '';
  const performancePayload = isBrowserChatScreenshotPerformanceLog(log) ? screenshotPerformancePayload(parsed) : '';
  const fallbackPayload = !requestPayload && !responsePayload && !timingPayload && !performancePayload && !errorPayload && !toolPayload
    ? log.details
    : '';
  return (
    <div className="browser-chat-log-details">
      <BrowserChatPayloadDetails className="browser-chat-log-detail-block" defaultOpen payload={fallbackPayload} title={t('日志详情')} />
      <BrowserChatPayloadDetails className="browser-chat-log-detail-block is-timing" defaultOpen payload={timingPayload} title={t('耗时明细')} />
      <BrowserChatPayloadDetails className="browser-chat-log-detail-block" defaultOpen payload={requestPayload} title={t('AI 输入 JSON')} />
      <BrowserChatPayloadDetails className="browser-chat-log-detail-block is-response" defaultOpen payload={responsePayload} title={t('AI 输出 JSON')} />
      {isAiResponseLog ? (
        <p className="browser-chat-log-token-count">{t('下次发送给 AI 的内容：{tokens}', {
          tokens: nextAiInputTokens === undefined ? t('尚未生成') : t('约 {count} tokens', { count: Math.round(nextAiInputTokens).toLocaleString() }),
        })}</p>
      ) : null}
      <BrowserChatPayloadDetails className="browser-chat-log-detail-block is-error" defaultOpen payload={errorPayload} title={t('错误详情')} />
      <BrowserChatPayloadDetails className="browser-chat-log-detail-block is-tool" defaultOpen payload={toolPayload} title={t('工具日志 JSON')} />
      <BrowserChatPayloadDetails className="browser-chat-log-detail-block is-performance" defaultOpen payload={performancePayload} title={t('截图性能')} />
    </div>
  );
}

const logVirtualRowEstimate = 76;

function BrowserChatLogEntry({
  log,
  measureRef,
  style,
  virtualIndex,
  nextAiInputTokens,
  updates,
}: {
  log: BrowserChatLogDialogRecord;
  measureRef?: (node: HTMLLIElement | null) => void;
  style?: CSSProperties;
  virtualIndex?: number;
  nextAiInputTokens?: number;
  updates?: BrowserChatLogDialogRecord[];
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const eventTitle = t(browserChatLogEventTitle(log));
  const eventMessage = t(log.message);
  const displayMessage = eventMessage.startsWith(eventTitle)
    ? eventMessage.slice(eventTitle.length).replace(/^[\s·:：-]+/, '')
    : eventMessage;
  const inputTokens = aiLogInputTokenCount(log);
  const timingLabel = aiLogTimingInline(log, t);
  const tone = browserChatLogTone(log);
  const canExpand = Boolean(log.details || updates?.length || displayMessage);
  const canCopy = phaseMatches(log, 'ai:runtime:response') || phaseMatches(log, 'ai:runtime:object');
  const copyEvent = async () => {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(eventMessage);
    } catch {
      // Keep the row action quiet when clipboard access is unavailable.
    }
  };
  return (
    <li
      className={`browser-chat-log-entry is-${tone}${expanded ? ' is-expanded' : ''}`}
      data-index={virtualIndex}
      ref={measureRef}
      style={style}
    >
      <time className="browser-chat-log-time" dateTime={log.time}>{formatLogTime(log.time)}</time>
      <div className="browser-chat-log-entry-content">
        <div className="browser-chat-log-entry-heading">
          <span aria-hidden="true" className="browser-chat-log-marker" />
          <strong className="browser-chat-log-event-title">{eventTitle}</strong>
          {updates && updates.length > 1 ? <span className="browser-chat-log-update-count">{t('{count} 次进度更新', { count: updates.length })}</span> : null}
          {log.stepIndex !== undefined || inputTokens !== undefined || timingLabel || typeof log.elapsedMs === 'number' ? (
            <small className="browser-chat-log-entry-meta">
              {log.stepIndex !== undefined ? <span>{t('步骤 {index}', { index: log.stepIndex })}</span> : null}
              {inputTokens !== undefined ? <span>{t('AI 输入 · {tokens}', { tokens: `${Math.round(inputTokens).toLocaleString()} tokens` })}</span> : null}
              {timingLabel ? <span>{timingLabel}</span> : typeof log.elapsedMs === 'number' ? <span>{formatTotalElapsedMs(log.elapsedMs)}</span> : null}
            </small>
          ) : null}
          {canCopy || canExpand ? (
            <div className="browser-chat-log-entry-actions">
              {canCopy ? (
                <button onClick={() => void copyEvent()} type="button">
                  <Copy size={15} />
                  {t('复制')}
                </button>
              ) : null}
              {canExpand ? (
                <button aria-expanded={expanded} onClick={() => setExpanded((current) => !current)} type="button">
                  {t(expanded ? '收起' : '展开')}
                  <ChevronRight className={expanded ? 'is-expanded' : ''} size={17} />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {displayMessage ? <p className="browser-chat-log-message">{displayMessage}</p> : null}
        <BrowserChatLogDetails expanded={expanded} log={log} nextAiInputTokens={nextAiInputTokens} />
        {expanded && updates && updates.length > 1 ? (
          <details className="browser-chat-log-progress-history">
            <summary>{t('查看全部 {count} 次进度更新', { count: updates.length })}</summary>
            <ol>{updates.map(update => <li key={update.id}>
              <time dateTime={update.time}>{formatLogTime(update.time)}</time>
              <div><p>{t(update.message)}</p>
                {update.details ? <BrowserChatPayloadDetails payload={update.details} title={t('日志详情')} /> : null}
              </div>
            </li>)}</ol>
          </details>
        ) : null}
      </div>
    </li>
  );
}

type BrowserChatTimelineRow = {
  key: string;
  log: BrowserChatLogDialogRecord;
  updates?: BrowserChatLogDialogRecord[];
};

function orderedBrowserChatLogs(entries: BrowserChatLogDialogRecord[]) {
  return [...entries].sort((a, b) => (Date.parse(a.time) || 0) - (Date.parse(b.time) || 0));
}

function logAttemptId(log: BrowserChatLogDialogRecord) {
  const details = aiLogPayloadDetails(parseJsonObjectText(log.details));
  return stringValue(asRecord(details?.execution)?.attemptId);
}

function browserChatTimelineRows(entries: BrowserChatLogDialogRecord[]): BrowserChatTimelineRow[] {
  const rows: BrowserChatTimelineRow[] = [];
  for (const log of entries) {
    const previous = rows.at(-1);
    // Only consecutive updates from the same request can share a row.
    // Build before filtering so search cannot join unrelated events.
    if (phaseMatches(log, 'ai:runtime:receiving') && previous
      && previous.log.phase === log.phase && previous.log.stepIndex === log.stepIndex
      && previous.log.message === log.message && logAttemptId(previous.log) === logAttemptId(log)) {
      previous.updates ||= [previous.log];
      previous.updates.push(log);
      previous.log = log;
    } else {
      rows.push({ key: log.id, log });
    }
  }
  return rows;
}

function nextInputTokensByLogId(entries: BrowserChatLogDialogRecord[]) {
  const tokensByLogId = new Map<string, number>();
  let nextInputTokens: number | undefined;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const log = entries[index];
    if (!log) continue;
    if (phaseMatches(log, 'ai:runtime:response') || phaseMatches(log, 'ai:runtime:object')) {
      if (nextInputTokens !== undefined) tokensByLogId.set(log.id, nextInputTokens);
    }
    const currentInputTokens = aiLogInputTokenCount(log);
    if (currentInputTokens !== undefined) nextInputTokens = currentInputTokens;
  }
  return tokensByLogId;
}

function BrowserChatVirtualLogList({ allEntries, rows }: { allEntries: BrowserChatLogDialogRecord[]; rows: BrowserChatTimelineRow[] }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const tokensByLogId = useMemo(() => nextInputTokensByLogId(allEntries), [allEntries]);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => logVirtualRowEstimate,
    getItemKey: (index) => rows[index]?.key || index,
    getScrollElement: () => scrollRef.current,
    overscan: 8,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div className="browser-chat-log-modal-list" ref={scrollRef}>
      <ol
        className="browser-chat-log-virtual-inner"
        style={{ height: rowVirtualizer.getTotalSize() }}
      >
        {virtualItems.map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;
          const virtualStyle: CSSProperties = {
            left: 0,
            position: 'absolute',
            top: 0,
            transform: `translateY(${virtualRow.start}px)`,
            width: '100%',
          };
          return (
            <BrowserChatLogEntry
              key={virtualRow.key}
              log={row.log}
              updates={row.updates}
              measureRef={rowVirtualizer.measureElement}
              style={virtualStyle}
              virtualIndex={virtualRow.index}
              nextAiInputTokens={tokensByLogId.get(row.log.id)}
            />
          );
        })}
      </ol>
    </div>
  );
}

export function BrowserChatLogDialog({
  entries,
  loadError,
  hasMore = false,
  loading = false,
  loadingMore = false,
  onClose,
  onLoadMore,
  onRetry,
  summaryEntries,
}: {
  entries: BrowserChatLogDialogRecord[];
  loadError?: string;
  hasMore?: boolean;
  loading?: boolean;
  loadingMore?: boolean;
  onClose: () => void;
  onLoadMore?: () => void | Promise<void>;
  onRetry?: () => void | Promise<void>;
  summaryEntries: BrowserChatLogDialogRecord[];
}) {
  const { t } = useI18n();
  const [activeFilter, setActiveFilter] = useState<BrowserChatLogFilter>('all');
  const [query, setQuery] = useState('');
  const orderedEntries = useMemo(() => orderedBrowserChatLogs(entries), [entries]);
  const summary = summarizeBrowserChatLogs(entries);
  const totals = summarizeBrowserChatExecutionTotals(summaryEntries);
  const statusEntries = useMemo(() => orderedBrowserChatLogs(summaryEntries.length ? summaryEntries : entries), [summaryEntries, entries]);
  const status = browserChatLogStatus(statusEntries);
  const totalElapsedMs = totals.aiRequestElapsedMs + totals.toolElapsedMs;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const rows = useMemo(() => browserChatTimelineRows(orderedEntries), [orderedEntries]);
  const filteredRows = useMemo(() => rows.filter(row => (row.updates || [row.log]).some(log => {
    if (!browserChatLogMatchesFilter(log, activeFilter)) return false;
    if (!normalizedQuery) return true;
    return `${t(log.message)}\n${t(phaseLabel(log.phase))}\n${log.phase}\n${log.details || ''}`
      .toLocaleLowerCase().includes(normalizedQuery);
  })), [activeFilter, normalizedQuery, rows, t]);
  const filterOptions: Array<{ count: number; filter: BrowserChatLogFilter; label: string }> = [
    { count: summary.total, filter: 'all', label: t('全部') },
    { count: summary.ai, filter: 'ai', label: 'AI' },
    { count: summary.tool, filter: 'tool', label: t('工具') },
    { count: summary.context, filter: 'context', label: t('上下文') },
    { count: summary.screenshot, filter: 'screenshot', label: t('截图') },
  ];

  return (
    <AppModal
      ariaLabelledBy="browser-chat-log-dialog-title"
      dialogClassName="browser-chat-log-dialog"
      onClose={onClose}
      size="log"
    >
        <header className="ui-modal-header browser-chat-log-dialog-header">
          <div className="browser-chat-log-heading">
            <div className="browser-chat-log-title-row">
              <h2 className="ui-modal-title" id="browser-chat-log-dialog-title">{t('执行日志')}</h2>
              <span className={`browser-chat-log-status is-${status}`}>{t(browserChatLogStatusLabel(status))}</span>
            </div>
            <p className="ui-modal-subtitle browser-chat-log-dialog-subtitle">
              <span>{t('{count} 条原始事件', { count: summary.total })}</span>
              <span aria-hidden="true">·</span>
              <span>{t('总耗时 {time}', { time: formatTotalElapsedMs(totalElapsedMs) })}</span>
            </p>
          </div>
          <div className="browser-chat-log-header-actions">
            <button className="browser-chat-log-close" onClick={onClose} type="button" aria-label={t('关闭')}>
              <X size={19} />
            </button>
          </div>
        </header>
        <div className="ui-modal-body browser-chat-log-modal-body">
          {entries.length ? (
            <div className="browser-chat-log-toolbar">
              <div aria-label={t('日志摘要')} className="browser-chat-log-filters" role="toolbar">
                {filterOptions.map((option) => (
                  <button
                    aria-pressed={activeFilter === option.filter}
                    className={activeFilter === option.filter ? 'is-active' : ''}
                    key={option.filter}
                    onClick={() => setActiveFilter(option.filter)}
                    type="button"
                  >
                    <span>{option.label}</span>
                    <strong>{option.count}</strong>
                  </button>
                ))}
              </div>
              <div className="browser-chat-log-search">
                <InputGroup fullWidth>
                  <InputGroup.Prefix><Search aria-hidden="true" size={16} /></InputGroup.Prefix>
                  <InputGroup.Input
                    aria-label={t('搜索日志')}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t('搜索日志')}
                    type="search"
                    value={query}
                  />
                </InputGroup>
              </div>
            </div>
          ) : null}
          {filteredRows.length ? (
            <BrowserChatVirtualLogList key={`${activeFilter}:${normalizedQuery}`} allEntries={orderedEntries} rows={filteredRows} />
          ) : (
            <div className="browser-chat-log-empty" role={loadError ? 'alert' : undefined}>
              <p>{loadError ? t('加载日志失败：{error}', { error: loadError }) : t(loading ? '正在加载日志' : entries.length ? '无匹配日志' : '暂无日志')}</p>
              {loadError && onRetry ? <button disabled={loading} onClick={() => void onRetry()} type="button">{t('重试')}</button> : null}
            </div>
          )}
          {loadError && entries.length ? (
            <div role="alert">
              <p>{t('加载日志失败：{error}', { error: loadError })}</p>
              {onRetry ? <button disabled={loading || loadingMore} onClick={() => void onRetry()} type="button">{t('重试')}</button> : null}
            </div>
          ) : null}
          {hasMore && onLoadMore ? (
            <button
              className="browser-chat-log-load-more"
              disabled={loadingMore}
              onClick={() => void onLoadMore()}
              type="button"
            >
              {t(loadingMore ? '正在加载更早日志' : '加载更早日志')}
            </button>
          ) : null}
        </div>
    </AppModal>
  );
}

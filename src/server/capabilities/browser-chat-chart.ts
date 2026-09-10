import {
  createChartCapability,
  createChartTool,
  readChart,
  updateChart,
  type ChartUpdateInput,
  type ChartToolInput,
  type ChartRecord,
} from '@webpilot/capability-chart';
import { createFileSystemChartStore, validateEChartsOption } from '@webpilot/capability-chart/node';
import { artifactPath } from '@/server/storage/paths';
import { capabilityResultToBrowserActionResult } from './browser-chat-result';
import { publishRealtimeRefreshEvent } from '@/server/realtime/ws-refresh';
import { normalizeApplicationUserId } from '@/server/auth/user-context';

const browserChatSessionIdPattern = /^(chat_[a-f0-9]{12})(?:_|$)/i;
const automationRunIdPattern = /^automation_run_[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const webPilotEChartsVersion = '6.1.0';

function browserChatSessionId(runId: string) {
  const normalized = String(runId || '').trim();
  if (automationRunIdPattern.test(normalized)) return normalized;
  const sessionId = normalized.match(browserChatSessionIdPattern)?.[1];
  if (!sessionId) throw new Error('Chart creation requires a valid browser-chat session run id.');
  return sessionId;
}

function chartStore(runId: string, userId?: string) {
  const scope = browserChatSessionId(runId);
  const store = createFileSystemChartStore({
    directory: artifactPath(scope, 'charts'),
  });
  const changed = (chart: ChartRecord | undefined) => {
    if (chart) void publishRealtimeRefreshEvent({ entityType: 'chart', id: `${scope}/${chart.chartId}`,
      userId: normalizeApplicationUserId(userId), patch: { revision: chart.revision } }).catch(() => undefined);
    return chart;
  };
  return { ...store,
    create: async (...args: Parameters<typeof store.create>) => { const chart = await store.create(...args); changed(chart); return chart; },
    update: async (...args: Parameters<NonNullable<typeof store.update>>) => changed(await store.update!(...args)),
  };
}

export const browserChatChartCapability = createChartCapability({
  echartsVersion: webPilotEChartsVersion,
  validateOption: validateEChartsOption,
  createStore(context) {
    return chartStore(context.runId, context.userId);
  },
});

export async function readBrowserChatChart(
  sessionId: string,
  chartId: string,
): Promise<ChartRecord | undefined> {
  return readChart(chartStore(sessionId), chartId);
}

export async function updateBrowserChatChart(sessionId: string, chartId: string, input: ChartUpdateInput, expectedRevision: number, userId?: string) {
  return updateChart(chartStore(sessionId, userId), chartId, input, expectedRevision, { validateOption: validateEChartsOption });
}

export async function executeBrowserChatChart(
  runId: string,
  input: unknown,
  options: { abortSignal?: AbortSignal; invocationId?: string; userId?: string } = {},
) {
  const tool = createChartTool(chartStore(runId, options.userId), {
    echartsVersion: webPilotEChartsVersion,
    validateOption: validateEChartsOption,
  });
  const parsed = tool.input.parse(input) as ChartToolInput;
  return capabilityResultToBrowserActionResult(await tool.execute(parsed, {
    invocationId: options.invocationId || `chart:${runId}`,
    abortSignal: options.abortSignal,
  }));
}

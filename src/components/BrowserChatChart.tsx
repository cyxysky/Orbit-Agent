'use client';

import { useMemo, useSyncExternalStore } from 'react';
import type { ChartRecord } from '@webpilot/capability-chart';
import { ChartRenderer } from '@webpilot/capability-chart/react';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';
import { useI18n } from '@/i18n/I18nProvider';
import { browserChatChartStore } from './browser-chat-chart-store';

export function BrowserChatChart({ chartId, sessionId, automationRunId }: { chartId: string; sessionId?: string; automationRunId?: string }) {
  const { t, language } = useI18n();
  const endpoint = withWebPilotBasePath(automationRunId
    ? `/api/automation/runs/${encodeURIComponent(automationRunId)}/charts/${encodeURIComponent(chartId)}`
    : `/api/browser-chat/${encodeURIComponent(sessionId || '')}/charts/${encodeURIComponent(chartId)}`);
  const identity = `${automationRunId || sessionId}/${chartId}`;
  const store = useMemo(() => browserChatChartStore(endpoint, identity), [endpoint, identity]);
  const { record, error } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);

  if (record) {
    return <ChartRenderer
      key={`${automationRunId || sessionId}/${chartId}`}
      chart={record}
      translate={t}
      excalidraw={{ assetPath: withWebPilotBasePath('/api/chart-assets/excalidraw/'), langCode: language === 'zh' ? 'zh-CN' : 'en' }}
      onReload={store.load}
      onSave={automationRunId ? undefined : async (next, expectedRevision) => {
        const response = await fetch(endpoint, {
          method: 'PATCH', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ expectedRevision, option: next.option }),
        });
        const payload = await response.json() as { chart?: ChartRecord; error?: string };
        if (!response.ok || !payload.chart) throw Object.assign(new Error(payload.error || '图表保存失败，请重试。'), { status: response.status });
        return store.publish(payload.chart);
      }}
      classNames={{
        root: 'browser-chat-chart',
        canvas: 'browser-chat-chart-canvas',
        surface: 'browser-chat-chart-surface',
      }}
    />;
  }
  return (
    <figure
      aria-label={chartId}
      className={`browser-chat-chart${error ? ' has-error' : ''}`}
      data-chart-id={chartId}
    >
      <div className="browser-chat-chart-canvas">
        {error
          ? <p role="alert">{t(error)}</p>
          : <span className="browser-chat-chart-loading">{t('正在加载图表…')}</span>}
      </div>
    </figure>
  );
}

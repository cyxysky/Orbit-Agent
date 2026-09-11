'use client';

import { lazy, useMemo, useSyncExternalStore } from 'react';
import { defineResponseRenderer, type ResponseComponentProps } from '@webpilot/capability-response/react';
import { chartResponse, chartResponses, type ChartResponseParams } from './response.ts';
import type { ChartRecord } from './core.ts';
import type { ChartRendererClassNames } from './react.tsx';

const ChartView = lazy(() => import('./react.tsx').then(module => ({ default: module.ChartRenderer })));
type Options = { excalidrawAssetPath?: string; classNames?: ChartRendererClassNames };
type Snapshot = { record: ChartRecord | null; error: string };
const empty: Snapshot = { record: null, error: '' };

function createStore(props: ResponseComponentProps<ChartResponseParams>) {
  const block = { type: chartResponse.type, params: { chartId: props.params.chartId } };
  let snapshot = empty;
  let request: Promise<ChartRecord> | undefined;
  let unsubscribe: (() => void) | undefined;
  let invalidation = 0;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => listener());
  const publish = (record: ChartRecord): ChartRecord => {
    const current = snapshot.record;
    if (current && (current.revision || 0) >= (record.revision || 0)) {
      if (snapshot.error) { snapshot = { ...snapshot, error: '' }; notify(); }
      return current;
    }
    snapshot = { record, error: '' }; notify(); return record;
  };
  const load = (): Promise<ChartRecord> => {
    if (request) return request;
    const started = invalidation;
    request = props.context.request<ChartRecord>(block, 'read').then(publish).catch(error => {
      snapshot = { ...snapshot, error: error instanceof Error ? error.message : String(error) }; notify(); throw error;
    }).finally(() => {
      request = undefined;
      if (listeners.size && started !== invalidation) void load().catch(() => {});
    });
    return request;
  };
  const refresh = () => { invalidation += 1; void load().catch(() => {}); };
  return {
    getSnapshot: () => snapshot, getServerSnapshot: () => empty, load, publish,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!unsubscribe) { unsubscribe = props.context.subscribe(block, refresh); refresh(); }
      return () => { listeners.delete(listener); if (!listeners.size) { unsubscribe?.(); unsubscribe = undefined; } };
    },
  };
}

export function createChartResponseRenderers(options: Options = {}) {
  function ChartResponseView({ params, context }: ResponseComponentProps<ChartResponseParams>) {
    const store = useMemo(() => createStore({ params: { chartId: params.chartId }, context }), [params.chartId, context]);
    const { record, error } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
    if (!record) return <div role={error ? 'alert' : 'status'}>{context.translate(error || '正在加载图表…')}</div>;
    return <ChartView chart={record} translate={context.translate} classNames={options.classNames}
      excalidraw={{ assetPath: options.excalidrawAssetPath, langCode: context.locale === 'zh' ? 'zh-CN' : 'en' }}
      onReload={store.load} onSave={context.readOnly ? undefined : async (next, expectedRevision) =>
        store.publish(await context.request<ChartRecord>({ type: chartResponse.type, params }, 'update', { expectedRevision, option: next.option }))} />;
  }
  return chartResponses.map(definition => defineResponseRenderer({ definition, component: ChartResponseView }));
}

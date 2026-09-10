'use client';

import type { ChartRecord } from '@webpilot/capability-chart';
import { subscribeRealtimeRefresh } from '@/lib/realtime-refresh';

type Snapshot = { record: ChartRecord | null; error: string };
const empty: Snapshot = { record: null, error: '' };
const stores = new Map<string, ReturnType<typeof createChartClientStore>>();

function createChartClientStore(endpoint: string, identity: string) {
  let snapshot = empty;
  let request: Promise<ChartRecord> | undefined;
  let unsubscribe: (() => void) | undefined;
  let invalidation = 0;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const publish = (record: ChartRecord) => {
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
    request = fetch(endpoint, { credentials: 'same-origin', cache: 'no-store' }).then(async (response) => {
      const payload = await response.json() as { chart?: ChartRecord; error?: string };
      if (!response.ok || !payload.chart) throw new Error(payload.error || '图表读取失败。');
      return publish(payload.chart);
    }).catch((reason) => {
      snapshot = { ...snapshot, error: reason instanceof Error ? reason.message : String(reason) }; notify(); throw reason;
    }).finally(() => {
      request = undefined;
      if (listeners.size && started !== invalidation) void load().catch(() => undefined);
    });
    return request;
  };
  const refresh = () => { invalidation += 1; void load().catch(() => undefined); };
  const store = {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => empty,
    publish,
    load,
    subscribe(listener: () => void) {
      stores.set(endpoint, store);
      listeners.add(listener);
      if (!unsubscribe) {
        unsubscribe = subscribeRealtimeRefresh((event) => {
          if (event.entityType === 'chart' && event.id === identity) refresh();
        }, { onResync: refresh });
        refresh();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) { unsubscribe?.(); unsubscribe = undefined; stores.delete(endpoint); }
      };
    },
  };
  return store;
}

export function browserChatChartStore(endpoint: string, identity: string) {
  const existing = stores.get(endpoint);
  if (existing) return existing;
  const store = createChartClientStore(endpoint, identity);
  stores.set(endpoint, store);
  return store;
}

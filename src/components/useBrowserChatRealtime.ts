'use client';

import { startTransition, useEffect, useRef } from 'react';
import {
  subscribeRealtimeRefresh,
  type RealtimeRefreshEvent,
} from '@/lib/realtime-refresh';

type BrowserChatRealtimeOptions = {
  onRefresh: (events: readonly RealtimeRefreshEvent[]) => void;
  onResync: (sessionIds?: readonly string[]) => void | Promise<void>;
};

const realtimeEventsPerFrame = 24;
const realtimeResyncDelayMs = 1_000;

export function useBrowserChatRealtime({ onRefresh, onResync }: BrowserChatRealtimeOptions) {
  const versionsRef = useRef(new Map<string, number>());
  const onRefreshRef = useRef(onRefresh);
  const onResyncRef = useRef(onResync);

  onRefreshRef.current = onRefresh;
  onResyncRef.current = onResync;

  useEffect(() => {
    const pending: RealtimeRefreshEvent[] = [];
    let frame: number | undefined;
    let resyncTimer: number | undefined;
    let disposed = false;
    let resyncing = false;
    let fullResyncRequested = false;
    const invalidatedSessionIds = new Set<string>();
    function scheduleResync(sessionIds?: readonly string[]) {
      if (disposed) return;
      if (sessionIds) sessionIds.forEach(id => invalidatedSessionIds.add(id));
      else fullResyncRequested = true;
      if (resyncing || resyncTimer !== undefined) return;
      resyncTimer = window.setTimeout(() => {
        resyncTimer = undefined;
        void resync().catch(() => undefined);
      }, realtimeResyncDelayMs);
    }
    async function resync() {
      if (disposed) return;
      const sessionIds = fullResyncRequested ? undefined : [...invalidatedSessionIds];
      fullResyncRequested = false;
      invalidatedSessionIds.clear();
      if (sessionIds?.length === 0) return;
      resyncing = true;
      try {
        await onResyncRef.current(sessionIds);
      } finally {
        resyncing = false;
        if (fullResyncRequested || invalidatedSessionIds.size) scheduleResync([]);
      }
    }
    const flush = () => {
      frame = undefined;
      if (!pending.length) return;
      const events = pending.splice(0, realtimeEventsPerFrame);
      startTransition(() => onRefreshRef.current(events));
      const invalidated = new Set<string>();
      for (const event of events) {
        if (event.deleted) {
          invalidatedSessionIds.delete(event.id);
          invalidated.delete(event.id);
        } else if (event.patch === undefined) invalidated.add(event.id);
      }
      if (invalidated.size) scheduleResync([...invalidated]);
      if (pending.length) frame = window.requestAnimationFrame(flush);
    };
    const unsubscribe = subscribeRealtimeRefresh((event) => {
      if (event.entityType !== 'browserChatSession') return;
      const lastVersion = versionsRef.current.get(event.id) || 0;
      if (event.version <= lastVersion) return;
      versionsRef.current.set(event.id, event.version);
      pending.push(event);
      if (frame === undefined) frame = window.requestAnimationFrame(flush);
    }, {
      onResync: () => scheduleResync(),
    });
    return () => {
      disposed = true;
      unsubscribe();
      pending.length = 0;
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (resyncTimer !== undefined) window.clearTimeout(resyncTimer);
    };
  }, []);
}

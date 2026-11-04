'use client';

import { startTransition, useCallback, useEffect, useRef } from 'react';
import { BoundedEventBuffer } from '@/lib/bounded-event-buffer';
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
const maxInvalidatedSessions = 32;
const maxRememberedVersions = 512;

export function useBrowserChatRealtime({ onRefresh, onResync }: BrowserChatRealtimeOptions) {
  const onRefreshRef = useRef(onRefresh);
  const onResyncRef = useRef(onResync);
  const invalidateRef = useRef<(sessionIds?: readonly string[]) => void>(() => undefined);

  onRefreshRef.current = onRefresh;
  onResyncRef.current = onResync;

  useEffect(() => {
    const pending = new BoundedEventBuffer<number, RealtimeRefreshEvent>();
    const versions = new Map<string, number>();
    const deletedSessionIds = new Set<string>();
    let sequence = 0;
    let frame: number | undefined;
    let resyncTimer: number | undefined;
    let disposed = false;
    let resyncing = false;
    let fullResyncRequested = false;
    let resyncingAll = false;
    let resyncingIds: readonly string[] = [];
    let retryDelayMs = realtimeResyncDelayMs;
    const invalidatedSessionIds = new Set<string>();
    const visible = () => document.visibilityState !== 'hidden';
    function scheduleResync() {
      if (disposed || !visible() || resyncing || resyncTimer !== undefined
        || (!fullResyncRequested && !invalidatedSessionIds.size)) return;
      resyncTimer = window.setTimeout(() => {
        resyncTimer = undefined;
        void resync();
      }, retryDelayMs);
    }
    function invalidate(sessionIds?: readonly string[]) {
      if (disposed) return;
      if (!sessionIds) fullResyncRequested = true;
      else if (!fullResyncRequested) {
        for (const id of sessionIds) {
          if (deletedSessionIds.has(id)) continue;
          invalidatedSessionIds.add(id);
          if (invalidatedSessionIds.size > maxInvalidatedSessions) {
            fullResyncRequested = true;
            break;
          }
        }
      }
      if (fullResyncRequested) invalidatedSessionIds.clear();
      // A persisted snapshot replaces discarded deltas. Never replay those
      // older packets after it, and never retain full payloads in the background.
      for (const [key, event] of pending.entries()) {
        if (fullResyncRequested || invalidatedSessionIds.has(event.id)) pending.delete(key);
      }
      scheduleResync();
    }
    async function resync() {
      if (disposed || !visible()) return;
      const sessionIds = fullResyncRequested ? undefined : [...invalidatedSessionIds];
      fullResyncRequested = false;
      invalidatedSessionIds.clear();
      if (sessionIds?.length === 0) return;
      resyncing = true;
      resyncingAll = sessionIds === undefined;
      resyncingIds = sessionIds || [];
      try {
        await onResyncRef.current(sessionIds);
        retryDelayMs = realtimeResyncDelayMs;
      } catch {
        // Failed reads must not acknowledge updates that were discarded.
        retryDelayMs = Math.min(8_000, retryDelayMs * 2);
        invalidate(sessionIds);
      } finally {
        resyncing = false;
        resyncingAll = false;
        resyncingIds = [];
        scheduleResync();
      }
    }
    const flush = () => {
      frame = undefined;
      if (!visible()) {
        invalidate([...new Set([...pending.values()].map(event => event.id))]);
        return;
      }
      const events = pending.take(realtimeEventsPerFrame);
      if (events.length) startTransition(() => onRefreshRef.current(events));
      if (pending.size) frame = window.requestAnimationFrame(flush);
    };
    const visibilityChanged = () => {
      if (!visible()) {
        if (frame !== undefined) window.cancelAnimationFrame(frame);
        frame = undefined;
        if (resyncTimer !== undefined) window.clearTimeout(resyncTimer);
        resyncTimer = undefined;
        invalidate([...new Set([...pending.values()].map(event => event.id))]);
      } else scheduleResync();
    };
    invalidateRef.current = invalidate;
    document.addEventListener('visibilitychange', visibilityChanged);
    const unsubscribe = subscribeRealtimeRefresh((event) => {
      if (event.entityType !== 'browserChatSession' || disposed) return;
      const lastVersion = versions.get(event.id) || 0;
      if (event.version <= lastVersion) return;
      versions.delete(event.id);
      versions.set(event.id, event.version);
      if (versions.size > maxRememberedVersions) {
        const oldestId = versions.keys().next().value!;
        versions.delete(oldestId);
        deletedSessionIds.delete(oldestId);
      }
      if (event.deleted) {
        deletedSessionIds.add(event.id);
        invalidatedSessionIds.delete(event.id);
        for (const [key, queued] of pending.entries()) if (queued.id === event.id) pending.delete(key);
        startTransition(() => onRefreshRef.current([event]));
        return;
      }
      deletedSessionIds.delete(event.id);
      if (!visible() || event.patch === undefined || fullResyncRequested || resyncingAll
        || invalidatedSessionIds.has(event.id) || resyncingIds.includes(event.id)) {
        invalidate([event.id]);
        return;
      }
      if (!pending.set(++sequence, event)) {
        invalidate([...new Set([...pending.values()].map(queued => queued.id)), event.id]);
        return;
      }
      if (frame === undefined) frame = window.requestAnimationFrame(flush);
    }, {
      onResync: () => invalidate(),
    });
    return () => {
      disposed = true;
      invalidateRef.current = () => undefined;
      unsubscribe();
      document.removeEventListener('visibilitychange', visibilityChanged);
      pending.clear();
      versions.clear();
      deletedSessionIds.clear();
      invalidatedSessionIds.clear();
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (resyncTimer !== undefined) window.clearTimeout(resyncTimer);
    };
  }, []);
  return useCallback((sessionIds?: readonly string[]) => invalidateRef.current(sessionIds), []);
}

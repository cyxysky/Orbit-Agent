'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { readSidebarCollapsedPreference, subscribeSidebarCollapsedPreference, writeSidebarCollapsedPreference } from '@/lib/sidebar-collapse';

/** Reuse the live snapshot on route mounts, even when prefetched props are stale. */
export function useSidebarCollapsed(initialCollapsed = false) {
  const getSnapshot = useCallback(() => readSidebarCollapsedPreference(initialCollapsed), [initialCollapsed]);
  const getServerSnapshot = useCallback(() => initialCollapsed, [initialCollapsed]);
  const collapsed = useSyncExternalStore(subscribeSidebarCollapsedPreference, getSnapshot, getServerSnapshot);
  useEffect(() => { writeSidebarCollapsedPreference(collapsed); }, [collapsed]);
  const toggle = useCallback(() => { writeSidebarCollapsedPreference(!readSidebarCollapsedPreference(initialCollapsed)); }, [initialCollapsed]);
  return { collapsed, toggle };
}

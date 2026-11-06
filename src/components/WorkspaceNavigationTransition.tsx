'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useTransition, type ReactNode } from 'react';
import { withoutWebPilotBasePath } from '@/lib/webpilot-base-path';
import { WorkspaceLoadingShell } from '@/components/WorkspaceLoadingShell';
import { WorkspaceNavigationContext, type WorkspacePath } from '@/components/workspace-navigation-context';

/** Acknowledge navigation before route data or code arrives; preserve source state until commit. */
export function WorkspaceNavigationTransition({ children }: { children: ReactNode }) {
  const pathname = withoutWebPilotBasePath(usePathname());
  const router = useRouter();
  const [navigating, transition] = useTransition();
  const [pendingPath, setPendingPath] = useState<WorkspacePath | null>(null);
  const startNavigation = useCallback((path: WorkspacePath) => {
    setPendingPath(path === pathname ? null : path);
    transition(() => router.push(path, { scroll: false }));
  }, [pathname, router]);
  useLayoutEffect(() => {
    if (pendingPath && (!navigating || pendingPath === pathname)) setPendingPath(null);
  }, [pathname, pendingPath, navigating]);
  useEffect(() => {
    const cancel = () => setPendingPath(null);
    window.addEventListener('popstate', cancel);
    return () => window.removeEventListener('popstate', cancel);
  }, []);
  const value = useMemo(() => ({ pendingPath, startNavigation }), [pendingPath, startNavigation]);
  return <WorkspaceNavigationContext.Provider value={value}>
    <div hidden={Boolean(pendingPath)} style={{ display: pendingPath ? 'none' : 'contents' }}>{children}</div>
    {pendingPath ? <WorkspaceLoadingShell route={pendingPath} focusHeading pending /> : null}
  </WorkspaceNavigationContext.Provider>;
}

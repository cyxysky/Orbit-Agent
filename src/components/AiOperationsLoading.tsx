'use client';

import { WorkspaceLoadingShell } from '@/components/WorkspaceLoadingShell';

export function AiOperationsLoading(props: { initialSidebarCollapsed?: boolean; error?: string; onRetry?: () => void }) {
  return <WorkspaceLoadingShell route="/admin/ai-operations" {...props} />;
}

import { redirect } from 'next/navigation';
import { AiOperationsWorkspace } from '@/components/AiOperationsWorkspace';
import { readBackendPageData, readWorkspacePageContext } from '@/lib/backend-page-data';
import type { ComponentProps } from 'react';
import '../../../styles/domains/ai-operations-workspace.css';

export const dynamic = 'force-dynamic';

export default async function AiOperationsPage() {
  const context = await readWorkspacePageContext();
  if (!context.admin) redirect('/browser-chat');
  return (
    <main className="browser-chat-shell ai-operations-page-shell">
      <AiOperationsWorkspace
        initialData={await readBackendPageData<ComponentProps<typeof AiOperationsWorkspace>['initialData']>('/api/admin/ai-operations?days=30')}
        initialSidebarCollapsed={context.sidebarCollapsed}
      />
    </main>
  );
}

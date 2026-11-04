import { redirect } from 'next/navigation';
import { AiOperationsWorkspace } from '@/components/AiOperationsWorkspace';
import { readWorkspacePageContext } from '@/lib/backend-page-data';
import '../../../styles/domains/ai-operations-workspace.css';

export const dynamic = 'force-dynamic';

export default async function AiOperationsPage() {
  const context = await readWorkspacePageContext();
  if (!context.admin) redirect('/browser-chat');
  return (
    <main className="browser-chat-shell ai-operations-page-shell">
      <AiOperationsWorkspace
        initialSidebarCollapsed={context.sidebarCollapsed}
      />
    </main>
  );
}

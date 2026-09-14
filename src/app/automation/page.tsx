import { AutomationWorkspace } from '@/components/AutomationWorkspace';
import { readWorkspacePageContext } from '@/lib/backend-page-data';
import '../styles/domains/automation-workspace.css';

export const dynamic = 'force-dynamic';

type AutomationPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AutomationPage({ searchParams }: AutomationPageProps) {
  const query = await searchParams;
  const context = await readWorkspacePageContext();
  const initialCaseId = firstQueryValue(query.caseId)?.trim() || '';
  return (
    <div className="browser-chat-shell automation-page-shell">
      <AutomationWorkspace
        defaultUserId={context.userId}
        initialCaseId={initialCaseId}
        initialSidebarCollapsed={context.sidebarCollapsed}
      />
    </div>
  );
}

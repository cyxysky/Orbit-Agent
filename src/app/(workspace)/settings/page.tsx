import { SettingsWorkspace } from '@/components/SettingsWorkspace';
import { readBackendPageData, readWorkspacePageContext } from '@/lib/backend-page-data';
import type { ComponentProps } from 'react';
import '../../styles/domains/settings-workspace.css';

export default async function SettingsPage() {
  const context = await readWorkspacePageContext();
  const adminPasswordRequired = context.adminSettingsPasswordRequired;
  return (
    <main className="browser-chat-shell">
      <SettingsWorkspace
        adminSettingsPasswordRequired={adminPasswordRequired}
        defaultUserId={context.userId}
        initialData={adminPasswordRequired ? undefined : await readBackendPageData<NonNullable<ComponentProps<typeof SettingsWorkspace>['initialData']>>('/api/settings/bootstrap')}
        initialSidebarCollapsed={context.sidebarCollapsed}
      />
    </main>
  );
}

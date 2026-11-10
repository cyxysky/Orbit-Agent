import { SettingsWorkspace } from '@/components/SettingsWorkspace';
import { readWorkspacePageContext } from '@/lib/backend-page-data';
import { redirect } from 'next/navigation';
import '../../styles/domains/settings-workspace.css';

export default async function SettingsPage() {
  const context = await readWorkspacePageContext();
  if (!context.settingsMenuVisible) redirect('/browser-chat');
  return (
    <main className="browser-chat-shell">
      <SettingsWorkspace
        defaultUserId={context.userId}
        initialSidebarCollapsed={context.sidebarCollapsed}
      />
    </main>
  );
}

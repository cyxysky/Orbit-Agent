import type { ReactNode } from 'react';
import { readWorkspacePageContext } from '@/lib/backend-page-data';
import { WorkspaceAccessProvider } from '@/components/WorkspaceAccessProvider';
import { FilePreviewProvider } from '@/components/FilePreviewProvider';
import { InterfaceMotion } from '@/components/InterfaceMotion';
import { WorkspaceNavigationTransition } from '@/components/WorkspaceNavigationTransition';
import { NavigationLoading } from '@/components/NavigationLoading';
import { AdministratorSessionGuard } from '@/components/AdministratorSession';

export async function WorkspaceApplicationLayout({ children }: { children: ReactNode }) {
  const context = await readWorkspacePageContext();
  return <WorkspaceAccessProvider settingsMenuVisible={context.settingsMenuVisible} initialSidebarCollapsed={context.sidebarCollapsed}
    showAiOperations={context.admin} administratorAuthenticated={context.administratorAuthenticated} administratorExpiresAt={context.administratorExpiresAt}>
    <FilePreviewProvider><InterfaceMotion /><AdministratorSessionGuard />
      <WorkspaceNavigationTransition>{children}</WorkspaceNavigationTransition><NavigationLoading />
    </FilePreviewProvider>
  </WorkspaceAccessProvider>;
}

import { BrowserChatWorkspaceLoader } from '@/components/BrowserChatWorkspaceLoader';
import { readWorkspacePageContext } from '@/lib/backend-page-data';
import 'katex/dist/katex.min.css';
import '../../styles/domains/browser-chat.css';

export default async function BrowserChatPage() {
  const context = await readWorkspacePageContext();
  return (
    <main className="browser-chat-shell">
      <BrowserChatWorkspaceLoader
        defaultUserId={context.userId}
        initialSidebarCollapsed={context.sidebarCollapsed}
      />
    </main>
  );
}

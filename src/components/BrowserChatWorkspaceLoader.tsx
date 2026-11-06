'use client';

import dynamic from 'next/dynamic';
import { WorkspaceLoadingShell } from '@/components/WorkspaceLoadingShell';

function BrowserChatLoading() {
  return <WorkspaceLoadingShell route="/browser-chat" />;
}

const BrowserChatWorkspace = dynamic(
  () => import('@/components/BrowserChatWorkspace').then((module) => module.BrowserChatWorkspace),
  {
    ssr: false,
    loading: () => <BrowserChatLoading />,
  },
);

export function BrowserChatWorkspaceLoader(props: {
  defaultUserId: string;
  initialSidebarCollapsed?: boolean;
}) {
  return <BrowserChatWorkspace {...props} />;
}

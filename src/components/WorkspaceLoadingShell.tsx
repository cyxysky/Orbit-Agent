'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react/button';
import { WorkspaceNavigationSidebar } from '@/components/WorkspaceSidebar';
import { WorkspacePageSkeleton } from '@/components/WorkspacePageSkeleton';
import { BrowserChatLoadingSkeleton } from '@/components/BrowserChatLoadingSkeleton';
import { useWorkspaceAccess } from '@/components/WorkspaceAccessProvider';
import type { WorkspacePath } from '@/components/workspace-navigation-context';
import { readSidebarCollapsedPreference, writeSidebarCollapsedPreference } from '@/lib/sidebar-collapse';
import { useTheme } from '@/theme/ThemeProvider';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './WorkspaceLoadingShell.module.css';

const titles: Record<WorkspacePath, string> = {
  '/browser-chat': '对话模式', '/automation': '自动化', '/admin/ai-operations': 'AI 运营中心', '/settings': '设置',
};

export function WorkspaceLoadingShell({ route, initialSidebarCollapsed, error, onRetry, focusHeading = false, pending = false }: {
  route: WorkspacePath;
  initialSidebarCollapsed?: boolean;
  error?: string;
  onRetry?: () => void;
  focusHeading?: boolean;
  pending?: boolean;
}) {
  const { t } = useI18n();
  const { mode, setMode } = useTheme();
  const access = useWorkspaceAccess();
  const initialCollapsed = initialSidebarCollapsed ?? access.initialSidebarCollapsed;
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { setCollapsed(readSidebarCollapsedPreference(initialCollapsed)); }, [initialCollapsed]);
  useEffect(() => { if (focusHeading) heading.current?.focus({ preventScroll: true }); }, [focusHeading, route]);
  const isChat = route === '/browser-chat';
  const variant = route === '/admin/ai-operations' ? 'overview' : route === '/settings' ? 'settings' : 'list';
  const label = t('正在切换界面');
  return <div className={`browser-chat-shell ${styles.shell}`} data-workspace-pending={pending ? route : undefined}>
    <section className={`browser-chat-layout ${styles.layout}${collapsed ? ' sidebar-collapsed' : ''}`}>
      <WorkspaceNavigationSidebar activeKey={route} collapsed={collapsed} showAiOperations={access.showAiOperations}
        onToggleCollapse={() => setCollapsed(current => { writeSidebarCollapsedPreference(!current); return !current; })}
        onThemeChange={setMode} themeMode={mode} translate={t}>{null}</WorkspaceNavigationSidebar>
      <main aria-busy={!error} className={`browser-chat-main ${styles.main}`}>
        <header className={styles.header}><h1 ref={heading} tabIndex={-1}>{t(titles[route])}</h1></header>
        <div className={`${styles.content}${isChat ? ` ${styles.chat}` : ''}`}>
          {error ? <div role="alert"><p>{t(error)}</p><Button onPress={onRetry} size="sm">{t('重试')}</Button></div>
            : isChat ? <BrowserChatLoadingSkeleton label={label} />
              : <WorkspacePageSkeleton label={label} variant={variant} showHeader={false} />}
        </div>
      </main>
    </section>
  </div>;
}

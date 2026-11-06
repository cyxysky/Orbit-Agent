'use client';

import { Gauge, MessageCircleMore, PanelLeft, Settings, Workflow } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ThemeMode } from '@/theme/ThemeProvider';
import { WebPilotHelpCenter } from '@/components/WebPilotHelpCenter';
import { AnimatedThemeToggler } from '@/components/ui/animated-theme-toggler';
import { AuroraText } from '@/components/ui/aurora-text';
import { useWorkspaceBrand } from '@/brand/WorkspaceBrandProvider';
import { OrbitIcon } from '@/components/OrbitIcon';
import { useWorkspaceAccess } from '@/components/WorkspaceAccessProvider';
import { useWorkspaceNavigation, type WorkspacePath } from '@/components/workspace-navigation-context';

type WorkspaceSidebarProps = {
  children: ReactNode;
  className?: string;
  collapsed: boolean;
  collapseLabel: string;
  onToggleCollapse: () => void;
  onThemeChange: (theme: ThemeMode) => void;
  themeMode: ThemeMode;
  themeToggleLabel: string;
  themeToggleTitle: string;
};

type WorkspaceModeKey = '/browser-chat' | '/automation' | '/admin/ai-operations' | '/settings';

type WorkspaceModeTabsProps = {
  activeKey: WorkspaceModeKey;
  aiOperationsLabel: string;
  ariaLabel: string;
  automationLabel: string;
  collapsed: boolean;
  conversationLabel: string;
  settingsLabel: string;
  showAiOperations?: boolean;
};

type WorkspaceNavigationSidebarProps = Pick<
  WorkspaceSidebarProps,
  'children' | 'className' | 'collapsed' | 'onThemeChange' | 'onToggleCollapse' | 'themeMode'
> & {
  activeKey: WorkspaceModeKey;
  showAiOperations?: boolean;
  translate: (value: string) => string;
};

export function WorkspaceModeTabs({
  activeKey,
  aiOperationsLabel,
  ariaLabel,
  automationLabel,
  conversationLabel,
  settingsLabel,
  showAiOperations = false,
}: WorkspaceModeTabsProps) {
  const { settingsMenuVisible } = useWorkspaceAccess();
  const { pendingPath, startNavigation } = useWorkspaceNavigation();
  const selectedKey = pendingPath || activeKey;
  const visibleConversationLabel = conversationLabel.replace(/(?:模式| Mode)$/u, '');
  const items = [
    { path: '/browser-chat', label: visibleConversationLabel, ariaLabel: conversationLabel, icon: MessageCircleMore },
    { path: '/automation', label: automationLabel, ariaLabel: automationLabel, icon: Workflow },
    ...(showAiOperations ? [{ path: '/admin/ai-operations', label: aiOperationsLabel, ariaLabel: aiOperationsLabel, icon: Gauge }] : []),
    ...(settingsMenuVisible ? [{ path: '/settings', label: settingsLabel, ariaLabel: settingsLabel, icon: Settings }] : []),
  ];

  return (
    <nav className="workspace-mode-tabs" aria-label={ariaLabel}>
      <div data-slot="tabs-list-container"><div className="tabs__list-container__scroller"><div data-slot="tabs-list">
        {items.map(({ path, label, ariaLabel: accessibleLabel, icon: Icon }) => <Link key={path} href={path} prefetch="auto" scroll={false}
          onNavigate={event => { if (startNavigation) { event.preventDefault(); startNavigation(path as WorkspacePath); } }}
          aria-label={accessibleLabel} aria-current={selectedKey === path ? 'page' : undefined} data-slot="tabs-tab" className="workspace-mode-link">
          <Icon aria-hidden="true" /><span className="workspace-mode-tab-label">{label}</span>
        </Link>)}
      </div></div></div>
    </nav>
  );
}

export function WorkspaceSidebar({
  children,
  className,
  collapsed,
  collapseLabel,
  onToggleCollapse,
  onThemeChange,
  themeMode,
  themeToggleLabel,
  themeToggleTitle,
}: WorkspaceSidebarProps) {
  const { brandPrefix, brandText } = useWorkspaceBrand();
  return (
    <aside className={className ? `browser-chat-sidebar ${className}` : 'browser-chat-sidebar'}>
      <div className="browser-chat-brand">
        <strong className="browser-chat-brand-title">
          <OrbitIcon size={16} />
          {brandPrefix ? <AuroraText className="browser-chat-brand-aurora" speed={1.2}>{brandPrefix}</AuroraText> : null}
          {brandText ? <span>{brandText}</span> : null}
        </strong>
        <button
          aria-label={collapseLabel}
          className="ui-icon-button"
          onClick={onToggleCollapse}
          title={collapseLabel}
          type="button"
        >
          {collapsed ? <OrbitIcon size={16} /> : <PanelLeft aria-hidden="true" size={18} />}
        </button>
      </div>

      {children}

      <div
        className="browser-chat-sidebar-footer"
        style={{
          alignItems: 'center',
          display: 'flex',
          flexDirection: collapsed ? 'column' : 'row',
          gap: collapsed ? 2 : undefined,
          justifyContent: collapsed ? 'center' : 'space-between',
        }}
      >
        <WebPilotHelpCenter collapsed={collapsed} />
        <AnimatedThemeToggler
          aria-label={themeToggleLabel}
          className="browser-chat-theme-toggle"
          duration={600}
          onThemeChange={onThemeChange}
          theme={themeMode}
          title={themeToggleTitle}
        />
      </div>
    </aside>
  );
}

export function WorkspaceNavigationSidebar({
  activeKey,
  children,
  className,
  collapsed,
  onThemeChange,
  onToggleCollapse,
  showAiOperations,
  themeMode,
  translate,
}: WorkspaceNavigationSidebarProps) {
  const lightTheme = themeMode === 'dark';
  return (
    <WorkspaceSidebar
      className={className}
      collapsed={collapsed}
      collapseLabel={translate(collapsed ? '展开侧边栏' : '折叠侧边栏')}
      onToggleCollapse={onToggleCollapse}
      onThemeChange={onThemeChange}
      themeMode={themeMode}
      themeToggleLabel={translate(lightTheme ? '切换到浅色模式' : '切换到深色模式')}
      themeToggleTitle={translate(lightTheme ? '浅色模式' : '深色模式')}
    >
      <WorkspaceModeTabs
        activeKey={activeKey}
        aiOperationsLabel={translate('AI 运营')}
        ariaLabel={translate('工作模式')}
        automationLabel={translate('自动化')}
        collapsed={collapsed}
        conversationLabel={translate('对话模式')}
        settingsLabel={translate('设置')}
        showAiOperations={showAiOperations}
      />
      {children}
    </WorkspaceSidebar>
  );
}

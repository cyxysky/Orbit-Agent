'use client';

import { useEffect, useState } from 'react';
import {
  Bot,
  BookOpen,
  Brain,
  Braces,
  Gauge,
  KeyRound,
  Palette,
  PanelLeft,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import type { EnvironmentSettingsInitialData } from '@/components/EnvironmentSettings';
import dynamic from 'next/dynamic';
import { WorkspaceContentSkeleton } from '@/components/WorkspaceContentSkeleton';
import {
  environmentSettingsTabGroups,
  environmentSettingsTabsForUser,
} from '@/components/environment-settings-model';
import { WorkspaceNavigationSidebar } from '@/components/WorkspaceSidebar';
import type { SettingsTab } from '@/config/settings';
import { useI18n } from '@/i18n/I18nProvider';
import { useSidebarCollapsed } from '@/hooks/useSidebarCollapsed';
import { useTheme } from '@/theme/ThemeProvider';


function SettingsContentLoading() {
  const { t } = useI18n();
  return <WorkspaceContentSkeleton label={t('正在读取配置')} />;
}

const EnvironmentSettings = dynamic(() => import('@/components/EnvironmentSettings').then(module => module.EnvironmentSettings), {
  loading: SettingsContentLoading,
});

function SettingsTabIcon({ tab }: { tab: SettingsTab }) {
  if (tab === 'general') return <Palette size={15} />;
  if (tab === 'model') return <Bot size={15} />;
  if (tab === 'browser') return <PanelLeft size={15} />;
  if (tab === 'sensitive-data') return <ShieldCheck size={15} />;
  if (tab === 'runtime') return <Gauge size={15} />;
  if (tab === 'knowledge') return <BookOpen size={15} />;
  if (tab === 'capabilities') return <Wrench size={15} />;
  if (tab === 'skills') return <Braces size={15} />;
  if (tab === 'memory') return <Brain size={15} />;
  if (tab === 'accounts') return <KeyRound size={15} />;
  return <Palette size={15} />;
}

export function SettingsWorkspace({
  defaultUserId,
  initialData,
  initialSidebarCollapsed = false,
}: {
  defaultUserId: string;
  initialData?: EnvironmentSettingsInitialData;
  initialSidebarCollapsed?: boolean;
}) {
  const { t } = useI18n();
  const { mode: themeMode, setMode } = useTheme();
  const { collapsed: sidebarCollapsed, toggle: toggleSidebarCollapsed } = useSidebarCollapsed(initialSidebarCollapsed);
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [requestedSection, setRequestedSection] = useState<string>();
  const visibleSettingsTabs = environmentSettingsTabsForUser(defaultUserId, defaultUserId);
  const selectedTab = visibleSettingsTabs.some((tab) => tab.id === activeTab) ? activeTab : 'general';

  function selectSettingsTab(requestedTab: SettingsTab, section?: string) {
    const tab = requestedTab === 'browser' ? 'capabilities' : requestedTab;
    const nextSection = requestedTab === 'browser' ? 'capability:browser' : section;
    if (!visibleSettingsTabs.some((item) => item.id === tab)) return;
    setRequestedSection(nextSection);
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      if (nextSection) url.searchParams.set('section', nextSection);
      else url.searchParams.delete('section');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }

  useEffect(() => {
    const selectTabFromLocation = () => {
      const url = new URL(window.location.href);
      const tab = url.searchParams.get('tab') as SettingsTab | null;
      if (tab) selectSettingsTab(tab, url.searchParams.get('section') || undefined);
    };
    selectTabFromLocation();
    window.addEventListener('popstate', selectTabFromLocation);
    return () => window.removeEventListener('popstate', selectTabFromLocation);
  // The visible tab list is fixed for the lifetime of the settings route.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className={sidebarCollapsed ? 'browser-chat-layout sidebar-collapsed settings-workspace-route' : 'browser-chat-layout settings-workspace-route'}>
      <WorkspaceNavigationSidebar
        activeKey="/settings"
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebarCollapsed}
        onThemeChange={setMode}
        showAiOperations={defaultUserId === '1'}
        themeMode={themeMode}
        translate={t}
      >
        <section className="browser-chat-sidebar-section browser-chat-settings-section">
          <nav className="browser-chat-subnav" aria-label={t('运行配置分类')}>
            {environmentSettingsTabGroups.map((group) => {
              const tabs = group.tabs.flatMap((tabId) => {
                const tab = visibleSettingsTabs.find((item) => item.id === tabId);
                return tab ? [tab] : [];
              });
              if (!tabs.length) return null;
              return (
                <div className="browser-chat-settings-nav-group" key={group.id}>
                  <span className="browser-chat-settings-nav-label">{t(group.label)}</span>
                  {tabs.map((tab) => (
                    <button
                      aria-current={selectedTab === tab.id ? 'page' : undefined}
                      aria-label={t(tab.label)}
                      className={selectedTab === tab.id ? 'active' : undefined}
                      key={tab.id}
                      onClick={() => selectSettingsTab(tab.id)}
                      title={t(tab.description)}
                      type="button"
                    >
                      <SettingsTabIcon tab={tab.id} />
                      <span>{t(tab.label)}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </nav>
        </section>
      </WorkspaceNavigationSidebar>

      <main className="browser-chat-main">
        <div className="browser-chat-settings-pane">
          <EnvironmentSettings
            activeTab={selectedTab}
            defaultUserId={defaultUserId}
            embedded
            initialData={initialData}
            initialSection={requestedSection}
            onActiveTabChange={selectSettingsTab}
            showTabs
            userId={defaultUserId}
          />
        </div>
      </main>
    </section>
  );
}

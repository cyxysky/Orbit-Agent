'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  Bot,
  BookOpen,
  Brain,
  Braces,
  Gauge,
  KeyRound,
  Loader2,
  Lock,
  Palette,
  PanelLeft,
  ShieldCheck,
  Wrench,
  X,
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
import { readApiJson } from '@/lib/api-client';
import { useSidebarCollapsed } from '@/hooks/useSidebarCollapsed';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';
import { useTheme } from '@/theme/ThemeProvider';
import { AppInput } from '@/components/ui/app-input';
import { AppModal } from '@/components/ui/app-modal';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';
import { useRouter } from 'next/navigation';


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
  adminSettingsPasswordRequired = false,
  defaultUserId,
  initialData,
  initialSidebarCollapsed = false,
}: {
  adminSettingsPasswordRequired?: boolean;
  defaultUserId: string;
  initialData?: EnvironmentSettingsInitialData;
  initialSidebarCollapsed?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const { mode: themeMode, setMode } = useTheme();
  const { collapsed: sidebarCollapsed, toggle: toggleSidebarCollapsed } = useSidebarCollapsed(initialSidebarCollapsed);
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [requestedSection, setRequestedSection] = useState<string>();
  const [adminSettingsAccessToken, setAdminSettingsAccessToken] = useState('');
  const [pendingAdminSettingsTab, setPendingAdminSettingsTab] = useState<SettingsTab | null>(adminSettingsPasswordRequired ? 'general' : null);
  const [adminSettingsPassword, setAdminSettingsPassword] = useState('');
  const [adminSettingsPasswordError, setAdminSettingsPasswordError] = useState('');
  const [adminSettingsPasswordSubmitting, setAdminSettingsPasswordSubmitting] = useState(false);
  const visibleSettingsTabs = environmentSettingsTabsForUser(defaultUserId, defaultUserId);
  const selectedTab = visibleSettingsTabs.some((tab) => tab.id === activeTab) ? activeTab : 'general';
  const adminSettingsLocked = adminSettingsPasswordRequired && !adminSettingsAccessToken;

  function closeAdminSettingsPasswordDialog() {
    if (adminSettingsPasswordSubmitting) return;
    setPendingAdminSettingsTab(null);
    setAdminSettingsPassword('');
    setAdminSettingsPasswordError('');
    if (adminSettingsLocked) router.replace('/browser-chat');
  }

  function selectSettingsTab(requestedTab: SettingsTab, section?: string) {
    const tab = requestedTab === 'browser' ? 'capabilities' : requestedTab;
    const nextSection = requestedTab === 'browser' ? 'capability:browser' : section;
    if (!visibleSettingsTabs.some((item) => item.id === tab)) return;
    setRequestedSection(nextSection);
    if (adminSettingsLocked) {
      setPendingAdminSettingsTab(tab);
      setAdminSettingsPassword('');
      setAdminSettingsPasswordError('');
      return;
    }
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

  async function submitAdminSettingsPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingAdminSettingsTab || adminSettingsPasswordSubmitting) return;
    setAdminSettingsPasswordSubmitting(true);
    setAdminSettingsPasswordError('');
    try {
      const response = await fetch(withWebPilotBasePath('/api/settings/admin-access'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminSettingsPassword }),
      });
      const data = await readApiJson<{ token?: string }>(response, t('管理员设置密码验证失败'));
      if (!data.token) throw new CodedError(ERROR_CODES.APPLICATION_ERROR, t('管理员设置访问令牌无效'));
      const nextTab = pendingAdminSettingsTab;
      setAdminSettingsAccessToken(data.token);
      setActiveTab(nextTab);
      const url = new URL(window.location.href);
      url.searchParams.set('tab', nextTab);
      if (requestedSection) url.searchParams.set('section', requestedSection);
      else url.searchParams.delete('section');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
      setPendingAdminSettingsTab(null);
      setAdminSettingsPassword('');
    } catch (error) {
      setAdminSettingsPasswordError(error instanceof Error ? error.message : t('管理员设置密码验证失败'));
    } finally {
      setAdminSettingsPasswordSubmitting(false);
    }
  }

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
        {!adminSettingsLocked ? <section className="browser-chat-sidebar-section browser-chat-settings-section">
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
        </section> : null}
      </WorkspaceNavigationSidebar>

      <main className="browser-chat-main">
        <div className="browser-chat-settings-pane">
          {!adminSettingsLocked ? <EnvironmentSettings
            activeTab={selectedTab}
            adminSettingsAccessToken={adminSettingsAccessToken}
            adminSettingsPasswordRequired={adminSettingsPasswordRequired}
            defaultUserId={defaultUserId}
            embedded
            initialData={initialData}
            initialSection={requestedSection}
            key={adminSettingsAccessToken || 'admin-settings-locked'}
            onActiveTabChange={selectSettingsTab}
            showTabs
            userId={defaultUserId}
          /> : null}
        </div>
      </main>

      {pendingAdminSettingsTab ? (
        <AppModal
          ariaLabelledBy="admin-settings-password-title"
          dismissable={!adminSettingsPasswordSubmitting}
          keyboardDismissable={!adminSettingsPasswordSubmitting}
          onClose={closeAdminSettingsPasswordDialog}
          size="sm"
        >
          <form className="webpilot-modal-form" onSubmit={(event) => void submitAdminSettingsPassword(event)}>
            <header className="ui-modal-header">
              <div className="ui-modal-heading">
                <h2 className="ui-modal-title" id="admin-settings-password-title">{t('管理员设置验证')}</h2>
              </div>
              <button
                aria-label={t('关闭')}
                className="ui-icon-button ui-modal-close"
                disabled={adminSettingsPasswordSubmitting}
                onClick={closeAdminSettingsPasswordDialog}
                type="button"
              >
                <X size={16} />
              </button>
            </header>
            <div className="ui-modal-body admin-settings-password-form">
              <label>
                <span>{t('管理员密码')}</span>
                <AppInput
                  autoComplete="current-password"
                  autoFocus
                  disabled={adminSettingsPasswordSubmitting}
                  maxLength={1_024}
                  onChange={(event) => setAdminSettingsPassword(event.target.value)}
                  prefix={<KeyRound aria-hidden="true" size={16} />}
                  type="password"
                  value={adminSettingsPassword}
                />
              </label>
              {adminSettingsPasswordError ? <div className="error" role="alert">{adminSettingsPasswordError}</div> : null}
            </div>
            <footer className="ui-modal-footer">
              <button className="ui-button ui-button--neutral" disabled={adminSettingsPasswordSubmitting} onClick={closeAdminSettingsPasswordDialog} type="button">
                {t('取消')}
              </button>
              <button className="ui-button ui-button--primary" disabled={adminSettingsPasswordSubmitting || !adminSettingsPassword} type="submit">
                {adminSettingsPasswordSubmitting ? <Loader2 className="spin" size={15} /> : <Lock size={15} />}
                {adminSettingsPasswordSubmitting ? t('正在验证') : t('解锁管理员设置')}
              </button>
            </footer>
          </form>
        </AppModal>
      ) : null}
    </section>
  );
}

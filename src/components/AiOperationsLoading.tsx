'use client';

import { useLayoutEffect, useState } from 'react';
import { WorkspaceNavigationSidebar } from '@/components/WorkspaceSidebar';
import { readSidebarCollapsedPreference, writeSidebarCollapsedPreference } from '@/lib/sidebar-collapse';
import { useTheme } from '@/theme/ThemeProvider';
import { useI18n } from '@/i18n/I18nProvider';
import { WorkspacePageSkeleton } from '@/components/WorkspacePageSkeleton';

export function AiOperationsLoading({ initialSidebarCollapsed = false, error, onRetry }: { initialSidebarCollapsed?: boolean; error?: string; onRetry?: () => void }) {
  const { t } = useI18n();
  const { mode, setMode } = useTheme();
  const [collapsed, setCollapsed] = useState(initialSidebarCollapsed);
  useLayoutEffect(() => { setCollapsed(readSidebarCollapsedPreference(initialSidebarCollapsed)); }, [initialSidebarCollapsed]);
  return (
    <section className={`browser-chat-layout ai-operations-layout${collapsed ? ' sidebar-collapsed' : ''}`}>
      <WorkspaceNavigationSidebar activeKey="/admin/ai-operations" collapsed={collapsed} onToggleCollapse={() => setCollapsed(current => { writeSidebarCollapsedPreference(!current); return !current; })} onThemeChange={setMode} showAiOperations themeMode={mode} translate={t}>{null}</WorkspaceNavigationSidebar>
      <main className="browser-chat-main ai-operations-main">
        <div className="ai-operations-content ai-operations-initial-loading" aria-busy={!error}>
          <header className="ai-operations-page-header"><div><h1>{t('AI 运营中心')}</h1><p>{t('查看 AI 对话、自动化运行、模型使用、异常任务与系统运行状态。')}</p></div></header>
          {error ? <div role="alert"><p>{t(error)}</p><button className="ui-button" onClick={onRetry} type="button">{t('重试')}</button></div>
            : <WorkspacePageSkeleton label={t('正在读取统计数据…')} variant="overview" showHeader={false} />}
        </div>
      </main>
    </section>
  );
}

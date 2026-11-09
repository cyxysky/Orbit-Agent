'use client';

import {
  Activity,
  Bot,
  CircleAlert,
  Gauge,
  LockKeyhole,
  RefreshCw,
  Timer,
  Users,
  Workflow,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CustomSelect } from '@/components/CustomSelect';
import { BackendRuntimePanel } from '@/components/BackendRuntimePanel';
import { AiOperationsLoading } from '@/components/AiOperationsLoading';
import { WorkspacePageSkeleton } from '@/components/WorkspacePageSkeleton';
import { DeferredContent } from '@/components/DeferredContent';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@heroui/react/empty-state';
import { DataTableStatus, DataTableText } from '@/components/ui/data-table-cells';
import { WorkspaceNavigationSidebar } from '@/components/WorkspaceSidebar';
import { useI18n } from '@/i18n/I18nProvider';
import { readApiJson } from '@/lib/api-client';
import { useSidebarCollapsed } from '@/hooks/useSidebarCollapsed';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';
import type {
  AiOperationsDashboardData,
  AiOperationsStatus,
  AiOperationsTrendPoint,
} from '@/server/observability/ai-operations-dashboard';
import { useTheme } from '@/theme/ThemeProvider';

const rangeOptions = [7, 30, 90] as const;

function formatCompactNumber(value: number, language: string) {
  return new Intl.NumberFormat(language === 'en' ? 'en-US' : 'zh-CN', {
    maximumFractionDigits: value >= 1000 ? 1 : 0,
    notation: value >= 10_000 ? 'compact' : 'standard',
  }).format(value || 0);
}

function percent(value: number) {
  return `${Number.isFinite(value) ? value.toFixed(value % 1 ? 1 : 0) : '0'}%`;
}

function duration(value: number) {
  if (!value) return '—';
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`;
  return `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1000)}s`;
}

function formatDateTime(value: string, language: string) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
  }).format(parsed);
}

function dayLabel(value: string) {
  return value.slice(5).replace('-', '/');
}

function statusLabel(status: AiOperationsStatus) {
  if (status === 'passed') return '成功';
  if (status === 'failed') return '失败';
  if (status === 'blocked') return '阻塞';
  if (status === 'running') return '执行中';
  if (status === 'interrupted') return '已中断';
  return '未知';
}

function MetricCard({
  detail,
  icon: Icon,
  label,
  tone = 'default',
  value,
}: {
  detail: string;
  icon: LucideIcon;
  label: string;
  tone?: 'danger' | 'default' | 'success' | 'warning';
  value: ReactNode;
}) {
  return (
    <article className={`ai-operations-metric-card tone-${tone}`}>
      <header><span>{label}</span><Icon aria-hidden="true" size={18} /></header>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function ChartShell({ actions, children, description, title }: { actions?: ReactNode; children: ReactNode; description: string; title: string }) {
  return (
    <section className="ai-operations-panel ai-operations-chart-panel">
      <header className="ai-operations-panel-header">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {actions ? <div className="ai-operations-chart-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

function UsageTrendChart({ points }: { points: AiOperationsTrendPoint[] }) {
  const { t } = useI18n();
  const maximum = Math.max(4, Math.ceil(Math.max(0, ...points.map((point) => point.chatTasks + point.automationRuns)) / 4) * 4);
  const labelEvery = points.length <= 7 ? 1 : points.length <= 30 ? 5 : 15;
  return (
    <div
      aria-label={t("对话任务与自动化运行使用趋势")}
      className="ai-operations-chart"
      data-density={points.length > 30 ? 'dense' : 'normal'}
      role="img"
    >
      <div className="ai-operations-chart-scale" aria-hidden="true">{[1, .75, .5, .25, 0].map((fraction) => <span key={fraction}>{maximum * fraction}</span>)}</div>
      <div className="ai-operations-chart-grid" aria-hidden="true"><span /><span /><span /><span /><span /></div>
      <div className="ai-operations-chart-columns">
        {points.map((point, index) => {
          const total = point.chatTasks + point.automationRuns;
          return (
            <div
              className="ai-operations-chart-column"
              key={point.date}
              title={t('{date}：对话 {chat}，自动化 {automation}', { date: point.date, chat: point.chatTasks, automation: point.automationRuns })}
            >
              <div className="ai-operations-chart-column-track">
                <div
                  className="ai-operations-stacked-bar usage-bar"
                  style={{ height: `${total ? Math.max(3, total / maximum * 100) : 0}%` }}
                >
                  <span className="is-chat" style={{ flexGrow: point.chatTasks }} />
                  <span className="is-automation" style={{ flexGrow: point.automationRuns }} />
                </div>
              </div>
              <span className="ai-operations-chart-label">
                {index % labelEvery === 0 || index === points.length - 1 ? dayLabel(point.date) : ''}
              </span>
            </div>
          );
        })}
      </div>
      <div className="ai-operations-chart-legend">
        <span><i className="is-chat" />{t("对话任务")}</span>
        <span><i className="is-automation" />{t("自动化运行")}</span>
      </div>
    </div>
  );
}

function OutcomeTrendChart({ points }: { points: AiOperationsTrendPoint[] }) {
  const { t } = useI18n();
  const maximum = Math.max(4, Math.ceil(Math.max(0, ...points.map((point) => point.passed + point.failed + point.blocked + point.interrupted)) / 4) * 4);
  const labelEvery = points.length <= 7 ? 1 : points.length <= 30 ? 5 : 15;
  return (
    <div aria-label={t("任务执行结果趋势")} className="ai-operations-chart" data-density={points.length > 30 ? 'dense' : 'normal'} role="img">
      <div className="ai-operations-chart-scale" aria-hidden="true">{[1, .75, .5, .25, 0].map((fraction) => <span key={fraction}>{maximum * fraction}</span>)}</div>
      <div className="ai-operations-chart-grid" aria-hidden="true"><span /><span /><span /><span /><span /></div>
      <div className="ai-operations-chart-columns">
        {points.map((point, index) => {
          const total = point.passed + point.failed + point.blocked + point.interrupted;
          return (
            <div
              className="ai-operations-chart-column"
              key={point.date}
              title={t('{date}：成功 {passed}，失败 {failed}，阻塞 {blocked}，中断 {interrupted}', { date: point.date, passed: point.passed, failed: point.failed, blocked: point.blocked, interrupted: point.interrupted })}
            >
              <div className="ai-operations-chart-column-track">
                <div
                  className="ai-operations-stacked-bar outcome-bar"
                  style={{ height: `${total ? Math.max(3, total / maximum * 100) : 0}%` }}
                >
                  <span className="is-passed" style={{ flexGrow: point.passed }} />
                  <span className="is-blocked" style={{ flexGrow: point.blocked }} />
                  <span className="is-failed" style={{ flexGrow: point.failed + point.interrupted }} />
                </div>
              </div>
              <span className="ai-operations-chart-label">
                {index % labelEvery === 0 || index === points.length - 1 ? dayLabel(point.date) : ''}
              </span>
            </div>
          );
        })}
      </div>
      <div className="ai-operations-chart-legend">
        <span><i className="is-passed" />{t("成功")}</span>
        <span><i className="is-blocked" />{t("阻塞")}</span>
        <span><i className="is-failed" />{t("失败/中断")}</span>
      </div>
    </div>
  );
}

export function AiOperationsWorkspace({ initialSidebarCollapsed = false }: { initialSidebarCollapsed?: boolean }) {
  const [data, setData] = useState<AiOperationsDashboardData>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(withWebPilotBasePath('/api/admin/ai-operations?days=30'), { cache: 'no-store', signal: controller.signal })
      .then(response => readApiJson<AiOperationsDashboardData>(response, '加载 AI 运营指标失败'))
      .then(next => { if (!controller.signal.aborted) setData(next); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '加载 AI 运营指标失败'); });
    return () => controller.abort();
  }, [attempt]);
  return data ? <AiOperationsDashboard initialData={data} initialSidebarCollapsed={initialSidebarCollapsed} />
    : <AiOperationsLoading initialSidebarCollapsed={initialSidebarCollapsed} error={error} onRetry={() => { setError(''); setAttempt(value => value + 1); }} />;
}

function AiOperationsDashboard({
  initialData,
  initialSidebarCollapsed = false,
}: {
  initialData: AiOperationsDashboardData;
  initialSidebarCollapsed?: boolean;
}) {
  const { t, language } = useI18n();
  const compactNumber = useCallback((value: number) => formatCompactNumber(value, language), [language]);
  const dateTime = (value: string) => formatDateTime(value, language);
  const { mode: themeMode, setMode } = useTheme();
  const { collapsed: sidebarCollapsed, toggle: toggleSidebar } = useSidebarCollapsed(initialSidebarCollapsed);
  const [data, setData] = useState(initialData);
  const [rangeDays, setRangeDays] = useState(initialData.rangeDays);
  const [requestedRangeDays, setRequestedRangeDays] = useState(initialData.rangeDays);
  const [trendUserId, setTrendUserId] = useState(initialData.trendUserId || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const dashboardRequest = useRef<AbortController | null>(null);
  const [activeView, setActiveView] = useState<'overview' | 'runtime'>('overview');
  const [trendView, setTrendView] = useState<'usage' | 'outcome'>('usage');

  useEffect(() => () => dashboardRequest.current?.abort(), []);


  const loadDashboard = useCallback(async (days: number, userId: string) => {
    dashboardRequest.current?.abort();
    const request = new AbortController();
    dashboardRequest.current = request;
    setRequestedRangeDays(days);
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ days: String(days) });
      if (userId) query.set('userId', userId);
      const response = await fetch(withWebPilotBasePath(`/api/admin/ai-operations?${query}`), {
        cache: 'no-store',
        signal: request.signal,
      });
      const nextData = await readApiJson<AiOperationsDashboardData>(response, '加载 AI 运营指标失败');
      if (request.signal.aborted || dashboardRequest.current !== request) return;
      setData(nextData);
      setRangeDays(days);
      setTrendUserId(nextData.trendUserId || '');
    } catch (loadError) {
      if (!request.signal.aborted && dashboardRequest.current === request) {
        setError(loadError instanceof Error ? loadError.message : '加载 AI 运营指标失败');
      }
    } finally {
      if (!request.signal.aborted && dashboardRequest.current === request) {
        dashboardRequest.current = null;
        setLoading(false);
      }
    }
  }, []);

  const overview = data.overview;
  const selectedRangeDays = loading ? requestedRangeDays : rangeDays;
  const trendUserOptions = useMemo(() => [
    { label: t('全部用户'), description: t('查看公司整体使用趋势'), value: '' },
    ...data.trendUsers.map((item) => ({
      description: t('{count} 个任务 · {tokens} Token', { count: item.totalTasks, tokens: compactNumber(item.totalTokens) }),
      label: t('用户 {id}', { id: item.userId }),
      selectedLabel: t('用户 {id}', { id: item.userId }),
      value: item.userId,
    })),
  ], [data.trendUsers, compactNumber, t]);
  const trendScopeLabel = trendUserId ? t('用户 {id}', { id: trendUserId }) : t('全部用户');

  return (
    <section className={sidebarCollapsed ? 'browser-chat-layout sidebar-collapsed ai-operations-layout' : 'browser-chat-layout ai-operations-layout'}>
      <WorkspaceNavigationSidebar
        activeKey="/admin/ai-operations"
        className="ai-operations-sidebar"
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebar}
        onThemeChange={setMode}
        showAiOperations
        themeMode={themeMode}
        translate={t}
      >
        <section aria-label={t('管理员')} className="browser-chat-sidebar-section ai-operations-sidebar-summary">
          <div aria-current="page" className="ai-operations-sidebar-current">
            <span className="ai-operations-sidebar-current-icon">
              <Gauge aria-hidden="true" size={16} />
            </span>
            <span>{t('运营视图')}</span>
          </div>
          <small className="ai-operations-sidebar-access">
            <LockKeyhole aria-hidden="true" size={12} />
            <span>{t('仅用户 1 可访问')}</span>
          </small>
        </section>
      </WorkspaceNavigationSidebar>

      <main className="browser-chat-main ai-operations-main">
        <div className="ai-operations-content" aria-busy={loading}>
          <header className="ai-operations-page-header">
            <div>
              <div className="ai-operations-eyebrow"><Activity size={14} /> {t('管理员专属')}</div>
              <h1>{t('AI 运营中心')}</h1>
              <p>{t('查看 AI 对话、自动化运行、模型使用、异常任务与系统运行状态。')}</p>
            </div>
            {activeView === 'overview' ? <div className="ai-operations-header-controls">
              <div className="ai-operations-range" aria-label={t('统计时间范围')}>
                {rangeOptions.map((days) => (
                  <button
                    aria-pressed={selectedRangeDays === days}
                    className={selectedRangeDays === days ? 'active' : undefined}
                    disabled={loading}
                    key={days}
                    onClick={() => void loadDashboard(days, trendUserId)}
                    type="button"
                  >
                    {days} {t('天')}
                  </button>
                ))}
              </div>
              <button
                className="ai-operations-refresh"
                disabled={loading}
                onClick={() => void loadDashboard(rangeDays, trendUserId)}
                type="button"
              >
                <RefreshCw className={loading ? 'spin' : undefined} size={15} />
                {t('刷新')}
              </button>
            </div> : null}
          </header>

          <div className="ai-operations-page-tabs" role="tablist" aria-label={t("AI 运营子页面")}>
            <button aria-selected={activeView === 'overview'} className={activeView === 'overview' ? 'active' : undefined} onClick={() => setActiveView('overview')} role="tab" type="button">{t("运营概览")}</button>
            <button aria-selected={activeView === 'runtime'} className={activeView === 'runtime' ? 'active' : undefined} onClick={() => setActiveView('runtime')} role="tab" type="button">{t("后端状态")}</button>
          </div>

          <div hidden={activeView !== 'overview'}>

          {loading ? <WorkspacePageSkeleton label={t('正在读取统计数据…')} variant="overview" showHeader={false} /> : <>

          <div className="ai-operations-meta-row">
            <span>{t('时区')}：{data.timezone}</span>
            <span>{t('更新时间')}：{dateTime(data.generatedAt)}</span>
            {error ? <strong role="alert">{t(error)}</strong> : null}
          </div>

          <section className="ai-operations-metric-grid" aria-label={t('系统与运营总览')}>
              <MetricCard detail={t('{chat} 对话 · {automation} 自动化', { chat: overview.chatTasks, automation: overview.automationRuns })} icon={Activity} label={t('任务总量')} value={compactNumber(overview.totalTasks)} />
              <MetricCard detail={t('{count} 个成功结果', { count: overview.passed })} icon={Gauge} label={t('任务成功率')} tone="success" value={percent(overview.successRate)} />
              <MetricCard detail={t('{failed} 失败 · {blocked} 阻塞', { failed: overview.failed, blocked: overview.blocked })} icon={CircleAlert} label={t('异常任务')} tone={overview.failed || overview.blocked ? 'danger' : 'default'} value={compactNumber(overview.failed + overview.blocked)} />
              <MetricCard detail={t('{count} 次进程内模型调用', { count: overview.modelCalls })} icon={Bot} label={t('模型 Token')} value={compactNumber(overview.inputTokens + overview.outputTokens)} />
          </section>

          <DeferredContent className="ai-operations-analysis-grid" estimatedHeight={340} label={t('正在读取统计数据…')}>
            <ChartShell
              title={t('趋势分析')}
              description={`${trendScopeLabel} · ${rangeDays} ${t('天')} · ${trendView === 'usage' ? t('按天统计对话请求与自动化运行次数') : t('按天查看成功、失败、阻塞与中断情况')}`}
              actions={<>
                <div className="ai-operations-chart-tabs" aria-label={t('趋势类型')}>
                  <button type="button" aria-pressed={trendView === 'usage'} onClick={() => setTrendView('usage')}>{t('使用量')}</button>
                  <button type="button" aria-pressed={trendView === 'outcome'} onClick={() => setTrendView('outcome')}>{t('执行结果')}</button>
                </div>
                <div className="ai-operations-trend-user-filter">
                  <CustomSelect
                    className="ai-operations-user-select"
                    disabled={loading}
                    onChange={(userId) => void loadDashboard(rangeDays, userId)}
                    options={trendUserOptions}
                    searchable={trendUserOptions.length > 8}
                    searchPlaceholder={t('搜索用户')}
                    title={t('选择要查看趋势的用户')}
                    value={trendUserId}
                  />
                </div>
              </>}
            >
              {trendView === 'usage' ? <UsageTrendChart points={data.trend} /> : <OutcomeTrendChart points={data.trend} />}
            </ChartShell>
            <section className="ai-operations-run-summary" aria-label={t('运行摘要')}>
              <header><h2>{t('运行摘要')}</h2><Activity aria-hidden="true" size={19} /></header>
              <div className="ai-operations-running-count"><strong>{compactNumber(overview.runningNow)}</strong><span>{t('当前执行中')}</span></div>
              <dl className="ai-operations-summary-list">
                <div><dt><Workflow size={15} />{t('启用的执行计划')}</dt><dd>{compactNumber(overview.enabledSchedules)}</dd></div>
                <div><dt><Timer size={15} />{t('平均耗时')}</dt><dd>{duration(overview.averageDurationMs)}<small>P95 {duration(overview.p95DurationMs)}</small></dd></div>
                <div><dt><Wrench size={15} />{t('AI 自动修复')}</dt><dd>{compactNumber(overview.repairs)}</dd></div>
                <div><dt><Users size={15} />{t('活跃用户')}</dt><dd>{compactNumber(overview.activeUsers)}</dd></div>
              </dl>
              <footer>{t('耗时、修复与用户按当前统计范围汇总')}</footer>
            </section>
          </DeferredContent>

          <DeferredContent className="ai-operations-lower-grid" estimatedHeight={480} label={t('正在读取统计数据…')}>
            <section className="ai-operations-panel ai-operations-incidents-panel">
              <header className="ai-operations-panel-header">
                <div>
                  <h2>{t('异常任务')}</h2>
                  <p>{t('最近失败、阻塞或中断的任务')}</p>
                </div>
                <span>{data.incidents.length}</span>
              </header>
              {data.incidents.length ? (
                <DataTable<AiOperationsDashboardData['incidents'][number]>
                  pagination filterable
                  columns={[
                    {
                      accessor: (item) => item.title,
                      cell: (item) => <DataTableText primary={item.title} href={item.href} secondary={item.reason} />,
                      header: t('任务'),
                      id: 'task',
                    },
                    { accessor: (item) => item.userId, cell: (item) => item.userId, header: t('用户'), id: 'user' },
                    { accessor: (item) => item.status, filterAccessor: item => `${item.status} ${t(statusLabel(item.status))}`, cell: (item) => <DataTableStatus status={item.status}>{t(statusLabel(item.status))}</DataTableStatus>, header: t('状态'), id: 'status' },
                    { accessor: (item) => item.target, cell: (item) => item.target, header: t('目标'), id: 'target' },
                    { accessor: (item) => item.time, filterAccessor: item => `${item.time} ${dateTime(item.time)}`, cell: (item) => dateTime(item.time), header: t('时间'), id: 'time' },
                  ]}
                  data={data.incidents}
                  emptyText={t('当前范围内没有异常任务')}
                  getRowId={(item) => item.id}
                  minWidth={650}
                />
              ) : <EmptyState>{t('当前范围内没有异常任务')}</EmptyState>}
            </section>

            <section className="ai-operations-panel ai-operations-systems-panel">
              <header className="ai-operations-panel-header">
                <div><h2>{t('目标系统')}</h2><p>{t('按浏览器目标域名统计任务量和成功率')}</p></div>
              </header>
              {data.systems.length ? (
                <DataTable<AiOperationsDashboardData['systems'][number]>
                  pagination filterable compact
                  columns={[
                    { id: 'target', header: t('目标'), accessor: item => item.target, cell: item => item.target },
                    { id: 'tasks', header: t('任务'), accessor: item => item.totalTasks, cell: item => item.totalTasks },
                    { id: 'success', header: t('成功率'), accessor: item => item.successRate, cell: item => percent(item.successRate) },
                  ]}
                  data={data.systems} emptyText={t('暂无目标系统使用数据')} getRowId={item => item.target} minWidth={360}
                />
              ) : <EmptyState>{t('暂无目标系统使用数据')}</EmptyState>}
            </section>
          </DeferredContent>

          <DeferredContent className="ai-operations-table-grid" estimatedHeight={480} label={t('正在读取统计数据…')}>
            <section className="ai-operations-table-section">
              <header className="ai-operations-panel-header"><div><h2>{t('用户使用情况')}</h2><p>{t('按用户统计任务量和执行结果')}</p></div></header>
              {data.users.length ? (
                <DataTable<AiOperationsDashboardData['users'][number]>
                  pagination filterable
                  columns={[
                    { accessor: (item) => item.userId, cell: (item) => <strong>{item.userId}</strong>, header: t('用户'), id: 'user' },
                    { accessor: (item) => item.totalTasks, cell: (item) => item.totalTasks, header: t('任务'), id: 'tasks' },
                    {
                      accessor: (item) => item.totalTokens,
                      cell: (item) => <DataTableText primary={compactNumber(item.totalTokens)} secondary={t('输入 {input} · 输出 {output}', { input: compactNumber(item.inputTokens), output: compactNumber(item.outputTokens) })} />,
                      header: t('Token 用量'),
                      id: 'tokens',
                    },
                    { accessor: (item) => item.chatTasks, cell: (item) => item.chatTasks, header: t('对话'), id: 'chat' },
                    { accessor: (item) => item.automationRuns, cell: (item) => item.automationRuns, header: t('自动化'), id: 'automation' },
                    { accessor: (item) => item.successRate, cell: (item) => percent(item.successRate), header: t('成功率'), id: 'success' },
                    { accessor: (item) => item.lastActiveAt, filterAccessor: item => `${item.lastActiveAt} ${dateTime(item.lastActiveAt)}`, cell: (item) => dateTime(item.lastActiveAt), header: t('最近使用'), id: 'recent' },
                  ]}
                  compact
                  data={data.users}
                  emptyText={t('暂无用户使用数据')}
                  getRowId={(item) => item.userId}
                  minWidth={680}
                />
              ) : <EmptyState>{t('暂无用户使用数据')}</EmptyState>}
            </section>

            <section className="ai-operations-table-section">
              <header className="ai-operations-panel-header"><div><h2>{t('模型使用情况')}</h2><p>{t('历史任务与当前服务进程 Token 指标')}</p></div></header>
              {data.models.length ? (
                <DataTable<AiOperationsDashboardData['models'][number]>
                  pagination filterable
                  columns={[
                    { accessor: (item) => item.model, cell: (item) => <DataTableText primary={item.model} secondary={item.provider} />, header: t('模型'), id: 'model' },
                    { accessor: (item) => item.taskCount, cell: (item) => item.taskCount, header: t('任务'), id: 'tasks' },
                    { accessor: (item) => item.calls, cell: (item) => compactNumber(item.calls), header: t('调用'), id: 'calls' },
                    { accessor: (item) => item.inputTokens, cell: (item) => compactNumber(item.inputTokens), header: t('输入 Token'), id: 'input' },
                    { accessor: (item) => item.outputTokens, cell: (item) => compactNumber(item.outputTokens), header: t('输出 Token'), id: 'output' },
                    { accessor: (item) => item.averageResponseMs, cell: (item) => duration(item.averageResponseMs), header: t('平均响应'), id: 'latency' },
                  ]}
                  compact
                  data={data.models}
                  emptyText={t('暂无模型使用数据')}
                  getRowId={(item) => `${item.provider}:${item.model}`}
                  minWidth={680}
                />
              ) : <EmptyState>{t('暂无模型使用数据')}</EmptyState>}
            </section>
          </DeferredContent>
          </>}
          </div>

          {activeView === 'runtime' ? <BackendRuntimePanel /> : null}

        </div>
      </main>
    </section>
  );
}

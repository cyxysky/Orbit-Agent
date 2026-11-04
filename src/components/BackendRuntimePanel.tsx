'use client';

import { Activity, CircleStop, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DataTable } from '@/components/ui/data-table';
import { WorkspacePageSkeleton } from '@/components/WorkspacePageSkeleton';
import { readApiJson } from '@/lib/api-client';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';
import { useI18n } from '@/i18n/I18nProvider';
import type { BackendRuntimeStatus } from '@/server/observability/backend-runtime-status';


export function BackendRuntimePanel() {
  const { t } = useI18n();
  const [data, setData] = useState<BackendRuntimeStatus>();
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState('');
  const [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    try {
      const response = await fetch(withWebPilotBasePath('/api/admin/ai-operations/runtime'), { cache: 'no-store', signal: controller.signal });
      const next = await readApiJson<BackendRuntimeStatus>(response, '加载后端状态失败');
      if (controller.signal.aborted) return;
      setData(next);
      setError('');
    } catch (loadError) {
      if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : '加载后端状态失败');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => { if (document.visibilityState === 'visible' && !requestRef.current?.signal.aborted) void load(); };
    const timer = window.setInterval(refresh, 10_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); requestRef.current?.abort(); };
  }, [load]);

  const closeBrowser = async (browserId: string) => {
    setClosing(browserId);
    try {
      const response = await fetch(withWebPilotBasePath(`/api/admin/ai-operations/runtime/browsers/${encodeURIComponent(browserId)}`), { method: 'DELETE' });
      await readApiJson(response, '关闭测试浏览器失败');
      await load();
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : '关闭测试浏览器失败');
    } finally {
      setClosing('');
    }
  };

  if (!data && loading) return <WorkspacePageSkeleton label={t('正在读取后端状态…')} />;

  return (
    <div className="ai-runtime-status" aria-busy={loading}>
      <div className="ai-runtime-toolbar">
        <div><strong>{t("当前后端状态")}</strong><span>{t("每 10 秒自动刷新，仅管理员 1 可见")}</span></div>
        <button onClick={() => void load()} type="button"><RefreshCw className={loading ? 'spin' : undefined} size={15} />{t("刷新")}</button>
      </div>
      {error ? <p className="ai-runtime-error" role="alert">{t(error)}</p> : null}
      <section className="ai-runtime-metrics">
        <article><Activity size={18} /><span>{t("活跃对话")}</span><strong>{data?.activeConversations || 0}</strong><small>{t("当前正在执行或排队")}</small></article>
        <article><CircleStop size={18} /><span>{t("测试浏览器")}</span><strong>{data?.browserCount || 0}</strong><small>{t("主会话与子 Agent 浏览器")}</small></article>
      </section>
      <section className="ai-operations-panel ai-runtime-browser-panel">
        <header className="ai-operations-panel-header"><div><h2>{t("当前测试浏览器")}</h2><p>{t("展示所属用户、会话、页面与实时状态")}</p></div><span>{data?.browsers.length || 0}</span></header>
        {data?.browsers.length ? (
          <DataTable<BackendRuntimeStatus['browsers'][number]>
            pagination filterable compact
            columns={[
              { id: 'page', header: t('页面'), accessor: item => item.title || item.sessionId, cell: item => <><strong>{item.title || item.sessionId}</strong><br /><small title={item.currentUrl}>{item.currentUrl || 'about:blank'}</small></> },
              { id: 'user', header: t('用户'), accessor: item => item.userId || '', cell: item => item.userId || t('未知') },
              { id: 'kind', header: t('类型'), accessor: item => t(item.kind === 'subagent' ? '子 Agent' : '主会话'), cell: item => t(item.kind === 'subagent' ? '子 Agent' : '主会话') },
              { id: 'tabs', header: t('标签页'), accessor: item => item.tabCount, cell: item => item.tabCount },
              { id: 'status', header: t('状态'), accessor: item => item.busy ? t('使用中') : t(({ initializing: '正在初始化', ready: '就绪', running: '执行中', completed: '已完成', interrupted: '已中断', failed: '失败', closed: '已结束', blocked: '阻塞' } as Record<string, string>)[item.status] || item.status), cell: item => item.busy ? t('使用中') : t(({ initializing: '正在初始化', ready: '就绪', running: '执行中', completed: '已完成', interrupted: '已中断', failed: '失败', closed: '已结束', blocked: '阻塞' } as Record<string, string>)[item.status] || item.status) },
              { id: 'actions', header: t('操作'), cell: item => <button className="ui-button" disabled={closing === item.id} onClick={() => void closeBrowser(item.id)} type="button"><CircleStop size={15} />{t(closing === item.id ? '关闭中…' : '关闭浏览器')}</button> },
            ]}
            data={data.browsers} emptyText={t('当前没有测试浏览器')} getRowId={item => item.id} minWidth={700}
          />
        ) : <div className="ai-operations-empty">{t("当前没有测试浏览器")}</div>}
      </section>
    </div>
  );
}

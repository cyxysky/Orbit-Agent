'use client';

import { Activity, CircleStop, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
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
  const load = useCallback(async () => {
    try {
      const response = await fetch(withWebPilotBasePath('/api/admin/ai-operations/runtime'), { cache: 'no-store' });
      setData(await readApiJson<BackendRuntimeStatus>(response, '加载后端状态失败'));
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载后端状态失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(timer);
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

  if (!data && loading) return <div className="ai-runtime-loading"><RefreshCw className="spin" size={18} /> {t("正在读取后端状态…")}</div>;

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
          <div className="ai-runtime-browser-list">
            {data.browsers.map((browser) => (
              <article key={browser.id}>
                <div><strong>{browser.title || browser.sessionId}</strong><span>{t('用户 {id} · {kind} · {count} 个标签页', { id: browser.userId || t('未知'), kind: t(browser.kind === 'subagent' ? '子 Agent' : '主会话'), count: browser.tabCount })}</span><code title={browser.currentUrl}>{browser.currentUrl || 'about:blank'}</code></div>
                <span className={browser.busy ? 'is-busy' : undefined}>{browser.busy ? t('使用中') : t(({ initializing: '正在初始化', ready: '就绪', running: '执行中', completed: '已完成', interrupted: '已中断', failed: '失败', closed: '已结束', blocked: '阻塞' } as Record<string, string>)[browser.status] || browser.status)}</span>
                <button disabled={closing === browser.id} onClick={() => void closeBrowser(browser.id)} type="button"><CircleStop size={15} />{t(closing === browser.id ? '关闭中…' : '关闭浏览器')}</button>
              </article>
            ))}
          </div>
        ) : <div className="ai-operations-empty">{t("当前没有测试浏览器")}</div>}
      </section>
    </div>
  );
}

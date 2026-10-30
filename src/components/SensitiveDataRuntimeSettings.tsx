'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import type { SensitiveDataInstallStatus } from '@cjfclonedeep/capability-sdk/sensitive-data/node';
import { useI18n } from '@/i18n/I18nProvider';
import { readApiJson } from '@/lib/api-client';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';
import './SensitiveDataRuntimeSettings.css';

export function SensitiveDataRuntimeSettings({ accessToken }: { accessToken: string }) {
  const { t } = useI18n();
  const [runtime, setRuntime] = useState<SensitiveDataInstallStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useCallback(async (install = false) => {
    const response = await fetch(withWebPilotBasePath('/api/settings/sensitive-data-runtime'), {
      method: install ? 'POST' : 'GET', cache: 'no-store',
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });
    const data = await readApiJson<{ runtime: SensitiveDataInstallStatus }>(response, t('读取或下载本地脱敏组件失败'));
    setRuntime(data.runtime);
    setError('');
  }, [accessToken, t]);
  useEffect(() => {
    let active = true;
    const refresh = () => void request().catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [request]);
  async function download() {
    setBusy(true);
    try { await request(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  const installing = runtime?.state === 'installing';
  const labels = { missing: '未下载', installing: '正在安装', ready: '已就绪', failed: '安装未完成' };
  return <section className="settings-local-runtime">
    <h3>{t('本地脱敏组件')}</h3>
    <p>{t('服务端安装包不包含脱敏 Python 环境和模型。需要本地脱敏时，请在此下载安装；完成后再开启敏感数据过滤。')}</p>
    <p>{t('首次下载约 4 GB，建议预留 10 GB 磁盘空间。由运行 Orbit 的服务器联网下载，耗时取决于网络；中断后可重试并复用缓存。')}</p>
    <p>{t('下载内容包括 Python、推理依赖和默认的通用、中文、PII 模型。下载不会自动开启脱敏，也不会上传业务内容。')}</p>
    <div className="settings-local-runtime-status" role="status">
      <strong>{t(runtime ? labels[runtime.state] : '正在读取状态')}</strong>
      {installing ? <><Loader2 size={16} className="spin" /><progress max={runtime.totalSteps} value={runtime.step} /><span>{runtime.step}/{runtime.totalSteps}</span></> : null}
    </div>
    {installing ? <pre>{runtime.message}</pre> : null}
    {runtime?.directory ? <p className="settings-local-runtime-directory">{t('保存位置')}：{runtime.directory}</p> : null}
    {runtime?.error ? <pre role="alert">{runtime.error}</pre> : null}
    {error ? <p role="alert">{error}</p> : null}
    <div className="settings-local-runtime-actions">
      <button type="button" disabled={busy || installing || !runtime || runtime.state === 'ready'} onClick={() => void download()}>
        {busy || installing ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
        {t(runtime?.state === 'failed' ? '重试下载' : runtime?.state === 'ready' ? '已安装' : '下载并安装')}
      </button>
      <button type="button" onClick={() => void request().catch(reason => setError(String(reason)))}><RefreshCw size={16} />{t('刷新状态')}</button>
    </div>
  </section>;
}

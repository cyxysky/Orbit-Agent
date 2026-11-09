'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@heroui/react/button';
import { TextArea } from '@heroui/react/textarea';
import { Download, Loader2, Plus, RefreshCw, Settings2, Square, Trash2, X } from 'lucide-react';
import { AppModal } from '@/components/ui/app-modal';
import { AppInput } from '@/components/ui/app-input';
import { SettingsDetailSection } from '@/components/SettingsDetailSection';
import { WorkspaceContentSkeleton } from '@/components/WorkspaceContentSkeleton';
import { useI18n } from '@/i18n/I18nProvider';
import { readApiJson } from '@/lib/api-client';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';
import { TOOL_CAPABILITY_SETTINGS_CHANGED_EVENT } from '@/lib/tool-capability-settings';
import type { ManagedToolStatus } from '@cjfclonedeep/capability-sdk/managed/node';
import styles from './ManagedToolSettings.module.css';

type Tool = ManagedToolStatus & { enabled: boolean; running: boolean; configuration: { envKeys: string[]; config: Record<string, unknown> } };
type EnvironmentRow = { id: string; key: string; original: string; value: string };

export function ManagedToolSettings({ accessToken }: { accessToken: string }) {
  const { t } = useI18n();
  const headers = useMemo(() => { const value: Record<string, string> = {}; if (accessToken) value.Authorization = `Bearer ${accessToken}`; return value; }, [accessToken]);
  const endpoint = withWebPilotBasePath('/api/settings/tools');
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Tool | null>(null);
  const [removing, setRemoving] = useState<Tool | null>(null);
  const [rows, setRows] = useState<EnvironmentRow[]>([]);
  const [config, setConfig] = useState('{}');
  const [formError, setFormError] = useState('');
  const installing = tools.some(tool => tool.state === 'installing');
  const load = useCallback(async (signal?: AbortSignal) => {
    const data = await readApiJson<{ tools: Tool[] }>(await fetch(endpoint, { headers, signal, cache: 'no-store' }), t('读取工具组件失败'));
    if (!signal?.aborted) { setTools(data.tools); setError(''); }
  }, [endpoint, headers, t]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch(value => { if (!controller.signal.aborted) setError(String(value.message || value)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    if (!installing) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = () => { timer = setTimeout(() => void load(controller.signal).catch(() => undefined).finally(() => { if (!controller.signal.aborted) poll(); }), 1500); };
    poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [installing, load]);
  async function mutate(tool: Tool, action: string, extra: Record<string, unknown> = {}) {
    setBusy(current => new Set(current).add(tool.id));
    try {
      await readApiJson(await fetch(endpoint, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ id: tool.id, action, ...extra }) }), t('更新工具组件失败'));
      await load();
      window.dispatchEvent(new Event(TOOL_CAPABILITY_SETTINGS_CHANGED_EVENT));
    } finally { setBusy(current => { const next = new Set(current); next.delete(tool.id); return next; }); }
  }
  function configure(tool: Tool) {
    setEditing(tool); setFormError('');
    setRows(tool.configuration.envKeys.map(key => ({ id: crypto.randomUUID(), key, original: key, value: '' })));
    setConfig(JSON.stringify(tool.configuration.config, null, 2));
  }
  async function save() {
    if (!editing) return;
    setFormError('');
    try {
      const parsed = JSON.parse(config);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(t('工具配置必须是 JSON 对象'));
      const keys = rows.map(row => row.key.trim());
      if (keys.some(key => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) || new Set(keys).size !== keys.length) throw new Error(t('环境变量名称无效或重复'));
      if (rows.some(row => row.original && row.original !== row.key.trim() && !row.value)) throw new Error(t('修改环境变量名称时需要重新填写值'));
      const env = Object.fromEntries(rows.filter(row => row.value || !row.original).map(row => [row.key.trim(), row.value]));
      const clearEnv = editing.configuration.envKeys.filter(key => !rows.some(row => row.original === key && row.key.trim() === key));
      await mutate(editing, 'configure', { configuration: { enabled: editing.enabled, env, config: parsed }, clearEnv });
      setEditing(null);
    } catch (value) { setFormError(value instanceof Error ? value.message : String(value)); }
  }
  const action = (tool: Tool, name: string, extra?: Record<string, unknown>) => void mutate(tool, name, extra).catch(value => setError(value instanceof Error ? value.message : String(value)));
  return <SettingsDetailSection heading={t('工具组件')} description={t('每个工具单独安装。仅安装所选工具及其必要依赖，启动 Orbit 不会自动安装全部工具。')}
    meta={<Button variant="ghost" size="sm" onPress={() => void load().catch(value => setError(String(value.message || value)))} aria-label={t('刷新')}><RefreshCw size={15} /></Button>}>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {loading ? <WorkspaceContentSkeleton label={t('正在读取工具组件')} /> : <div className={styles.list}>
      {tools.map(tool => <article className={styles.row} key={tool.id}>
        <div className={styles.copy}>
          <div className={styles.heading}><h4>{t(tool.title)}</h4><span className={styles.state} data-state={tool.state}>
            {tool.state === 'installing' ? <Loader2 className="spin" size={13} /> : null}
            {t(tool.state === 'ready' ? tool.enabled ? '已启用' : '已安装' : tool.state === 'installing' ? '安装中' : tool.state === 'failed' ? '安装失败' : '未安装')}
          </span></div>
          <p>{t(tool.description)}</p>
          {tool.state === 'installing' ? <p role="status">{t(tool.message)}</p> : null}
          {tool.error && tool.state === 'failed' ? <details><summary>{t('查看错误详情')}</summary><pre>{tool.error}</pre></details> : null}
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" size="sm" isDisabled={busy.has(tool.id) || tool.state === 'installing'} onPress={() => configure(tool)} aria-label={`${t('配置')} · ${t(tool.title)}`}><Settings2 size={15} />{t('配置')}</Button>
          {tool.state === 'ready' ? <>
            {tool.running ? <Button size="sm" variant="secondary" isDisabled={busy.has(tool.id)} onPress={() => action(tool, 'stop')}><Square size={13} />{t('停止')}</Button> : null}
            <Button size="sm" variant={tool.enabled ? 'secondary' : 'primary'} isDisabled={busy.has(tool.id)} onPress={() => action(tool, 'configure', {
              configuration: { enabled: !tool.enabled, env: {}, config: tool.configuration.config },
            })}>{t(tool.enabled ? '禁用' : '启用')}</Button>
            <Button size="sm" variant="ghost" isDisabled={busy.has(tool.id)} onPress={() => setRemoving(tool)} aria-label={`${t('卸载')} · ${t(tool.title)}`}><Trash2 size={15} /></Button>
          </> : <Button size="sm" variant="secondary" isDisabled={busy.has(tool.id) || tool.state === 'installing'} onPress={() => action(tool, 'install')}>
            {busy.has(tool.id) || tool.state === 'installing' ? <Loader2 className="spin" size={15} /> : <Download size={15} />}{t(tool.state === 'failed' ? '重试安装' : '安装')}
          </Button>}
        </div>
      </article>)}
    </div>}
    {editing ? <AppModal size="wide" ariaLabel={`${t(editing.title)} · ${t('工具配置')}`} dismissable={!busy.has(editing.id)} onClose={() => { if (!busy.has(editing.id)) setEditing(null); }}>
      <header className="ui-modal-header"><h2 className="ui-modal-title">{t(editing.title)} · {t('工具配置')}</h2>
        <button type="button" className="ui-icon-button ui-modal-close" disabled={busy.has(editing.id)} aria-label={t('关闭')} onClick={() => setEditing(null)}><X size={18} /></button></header>
      <div className="ui-modal-body"><fieldset disabled={busy.has(editing.id)} className={styles.configuration}>
        <section><div className={styles.sectionHeading}><h3>{t('环境变量')}</h3><Button size="sm" variant="secondary" onPress={() => setRows(current => [...current, { id: crypto.randomUUID(), key: '', original: '', value: '' }])}><Plus size={14} />{t('添加')}</Button></div>
          <p className={styles.hint}>{t('已保存的值不会回显；留空保留原值。保存后，下次调用使用新配置。')}</p>
          {rows.length ? rows.map(row => <div className={styles.environment} key={row.id}>
            <AppInput aria-label={t('环境变量名称')} placeholder="API_KEY" value={row.key} onChange={event => setRows(current => current.map(item => item.id === row.id ? { ...item, key: event.target.value } : item))} />
            <AppInput aria-label={t('环境变量值')} type="password" autoComplete="new-password" placeholder={t(row.original ? '已配置，留空保留' : '值')} value={row.value} onChange={event => setRows(current => current.map(item => item.id === row.id ? { ...item, value: event.target.value } : item))} />
            <Button isIconOnly size="sm" variant="ghost" aria-label={`${t('移除')} ${row.key}`} onPress={() => setRows(current => current.filter(item => item.id !== row.id))}><Trash2 size={15} /></Button>
          </div>) : <p className={styles.hint}>{t('尚未设置环境变量')}</p>}
        </section>
        <section><h3>{t('工具配置')}</h3><p className={styles.hint}>{t('使用 SDK 的分组配置格式，例如 tools 下对应的工具配置。密钥请通过环境变量引用。')}</p>
          <TextArea aria-label={t('工具配置')} rows={8} style={{ minHeight: '12rem' }} spellCheck={false} value={config} onChange={event => setConfig(event.target.value)} className={styles.json} />
        </section>
        {formError ? <p role="alert" className={styles.error}>{formError}</p> : null}
      </fieldset></div>
      <footer className="ui-modal-footer"><Button variant="secondary" isDisabled={busy.has(editing.id)} onPress={() => setEditing(null)}>{t('取消')}</Button><Button isDisabled={busy.has(editing.id)} onPress={() => void save()}>{busy.has(editing.id) ? <Loader2 className="spin" size={15} /> : null}{t('保存')}</Button></footer>
    </AppModal> : null}
    {removing ? <AppModal size="sm" ariaLabel={t('卸载工具')} dismissable={!busy.has(removing.id)} onClose={() => setRemoving(null)}>
      <header className="ui-modal-header"><h2 className="ui-modal-title">{t('卸载')} {t(removing.title)}</h2></header>
      <div className="ui-modal-body"><p>{t('卸载此工具的程序和依赖。对话、文件和其他工具使用的共享运行环境会保留。')}</p></div>
      <footer className="ui-modal-footer"><Button variant="secondary" isDisabled={busy.has(removing.id)} onPress={() => setRemoving(null)}>{t('取消')}</Button><Button isDisabled={busy.has(removing.id)} onPress={() => void mutate(removing, 'uninstall').then(() => setRemoving(null)).catch(value => { setError(String(value.message || value)); setRemoving(null); })}>{t('卸载')}</Button></footer>
    </AppModal> : null}
  </SettingsDetailSection>;
}

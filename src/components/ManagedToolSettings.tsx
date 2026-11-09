'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '@heroui/react/button';
import { TextArea } from '@heroui/react/textarea';
import { Download, Loader2, Plus, Search, Square, Trash2, X } from 'lucide-react';
import { AppModal } from '@/components/ui/app-modal';
import { AppInput } from '@/components/ui/app-input';
import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { SettingsDetailSection } from '@/components/SettingsDetailSection';
import { ToolCapabilitySettings } from '@/components/ToolCapabilitySettings';
import { ExternalIntegrationSettings } from '@/components/ExternalIntegrationSettings';
import { WorkspaceContentSkeleton } from '@/components/WorkspaceContentSkeleton';
import { useI18n } from '@/i18n/I18nProvider';
import { readApiJson } from '@/lib/api-client';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';
import { TOOL_CAPABILITY_SETTINGS_CHANGED_EVENT, toolCapabilitySettings } from '@/lib/tool-capability-settings';
import type { ManagedToolStatus } from '@cjfclonedeep/capability-sdk/managed/node';
import styles from './ManagedToolSettings.module.css';

type Tool = ManagedToolStatus & { enabled: boolean; running: boolean; configuration: { envKeys: string[]; config: Record<string, unknown> } };
type EnvironmentRow = { id: string; key: string; original: string; value: string };
type Props = {
  accessToken: string;
  items: readonly { key: string; value: string; enabled?: boolean }[];
  onChange: (key: string, enabled: boolean) => void;
  onSave: () => Promise<void>;
  renderConfiguration: (tool: string, query: string, onBusyChange: (busy: boolean) => void) => ReactNode;
  saving?: boolean;
  openTool?: string;
  onConfigurationClosed?: () => void;
};

export function ManagedToolSettings({ accessToken, items, onChange, onSave, renderConfiguration, saving = false, openTool, onConfigurationClosed }: Props) {
  const { t } = useI18n();
  const headers = useMemo(() => { const value: Record<string, string> = {}; if (accessToken) value.Authorization = 'Bearer ' + accessToken; return value; }, [accessToken]);
  const endpoint = withWebPilotBasePath('/api/settings/tools');
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState('');
  const [tab, setTab] = useState('configuration');
  const [query, setQuery] = useState('');
  const [configurationBusy, setConfigurationBusy] = useState(false);
  const [removing, setRemoving] = useState<Tool | null>(null);
  const [removeError, setRemoveError] = useState('');
  const [rows, setRows] = useState<EnvironmentRow[]>([]);
  const [config, setConfig] = useState('{}');
  const [formError, setFormError] = useState('');
  const installing = tools.some(tool => tool.state === 'installing');
  const editing = tools.find(tool => tool.id === editingId);
  const definition = toolCapabilitySettings.find(tool => tool.name === editingId);
  const locked = saving || busy.has(editingId) || configurationBusy;
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
  useEffect(() => { if (openTool && !loading) configure(openTool); }, [openTool, loading]);
  async function mutate(tool: Tool, action: string, extra: Record<string, unknown> = {}) {
    setBusy(current => new Set(current).add(tool.id));
    try {
      await readApiJson(await fetch(endpoint, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ id: tool.id, action, ...extra }) }), t('更新工具组件失败'));
      await load();
      window.dispatchEvent(new Event(TOOL_CAPABILITY_SETTINGS_CHANGED_EVENT));
    } finally { setBusy(current => { const next = new Set(current); next.delete(tool.id); return next; }); }
  }
  function configure(id: string) {
    const tool = tools.find(item => item.id === id);
    setEditingId(id); setTab(tool && tool.state !== 'ready' ? 'runtime' : 'configuration'); setQuery(''); setFormError(''); setConfigurationBusy(false);
    setRows((tool?.configuration.envKeys || []).map(key => ({ id: crypto.randomUUID(), key, original: key, value: '' })));
    setConfig(JSON.stringify(tool?.configuration.config || {}, null, 2));
  }
  function close() { if (!locked) { setEditingId(''); onConfigurationClosed?.(); } }
  async function toggle(key: string, enabled: boolean) {
    const toolName = toolCapabilitySettings.find(item => item.envKey === key)?.name;
    const tool = tools.find(item => item.id === toolName);
    try {
      if (tool) await mutate(tool, 'configure', { configuration: { enabled, env: {}, config: tool.configuration.config } });
      onChange(key, enabled);
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
  }
  async function persistComponent() {
    if (!editing) return;
    const parsed = JSON.parse(config);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(t('工具配置必须是 JSON 对象'));
    const keys = rows.map(row => row.key.trim());
    if (keys.some(key => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) || new Set(keys).size !== keys.length) throw new Error(t('环境变量名称无效或重复'));
    if (rows.some(row => row.original && row.original !== row.key.trim() && !row.value)) throw new Error(t('修改环境变量名称时需要重新填写值'));
    const env = Object.fromEntries(rows.filter(row => row.value || !row.original).map(row => [row.key.trim(), row.value]));
    const clearEnv = editing.configuration.envKeys.filter(key => !rows.some(row => row.original === key && row.key.trim() === key));
    await mutate(editing, 'configure', { configuration: { enabled: editing.enabled, env, config: parsed }, clearEnv });
  }
  async function save() {
    setFormError('');
    try { await persistComponent(); await onSave(); setEditingId(''); onConfigurationClosed?.(); }
    catch (value) { setFormError(value instanceof Error ? value.message : String(value)); }
  }
  async function install() {
    if (!editing) return;
    setFormError('');
    try { await persistComponent(); await mutate(editing, 'install'); }
    catch (value) { setFormError(value instanceof Error ? value.message : String(value)); }
  }
  return <div className={styles.workspace}>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {loading ? <WorkspaceContentSkeleton label={t('正在读取工具组件')} /> : <>
      <ToolCapabilitySettings items={items} components={tools} busy={busy} onChange={(key, enabled) => void toggle(key, enabled)} onConfigure={configure} />
      <SettingsDetailSection heading={t('MCP 服务')} description={t('每个服务单独启停，服务内的工具在齿轮配置中分别控制。')}>
        <ExternalIntegrationSettings accessToken={accessToken} category="connector" />
      </SettingsDetailSection>
    </>}
    {definition ? <AppModal size="wide" dialogClassName={styles.modal} ariaLabel={t(definition.label) + ' · ' + t('工具配置')} dismissable={!locked} keyboardDismissable={!locked} onClose={close}>
      <header className="ui-modal-header"><h2 className="ui-modal-title">{t(definition.label)} · {t('工具配置')}</h2>
        <button type="button" className="ui-icon-button ui-modal-close" disabled={locked} aria-label={t('关闭')} onClick={close}><X size={18} /></button></header>
      <div className={styles.tabs} role="tablist" aria-label={t('工具配置分组')}>
        {[{ id: 'configuration', title: '配置' }, ...(editing ? [{ id: 'runtime', title: '安装与运行' }, { id: 'advanced', title: '高级' }] : [])].map(item =>
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} disabled={locked} onClick={() => setTab(item.id)}>{t(item.title)}</button>)}
      </div>
      <div className="ui-modal-body">
        {tab === 'configuration' ? <div className={styles.configuration}>
          <AppInput aria-label={t('搜索配置')} placeholder={t('搜索配置')} prefix={<Search size={15} />} value={query} onChange={event => setQuery(event.target.value)} />
          {renderConfiguration(editingId, query, setConfigurationBusy)}
        </div> : null}
        {tab === 'runtime' && editing ? <section className={styles.configuration}>
          <div className={styles.sectionHeading}><h3>{t(editing.title)}</h3><span className={styles.state}>{t(editing.state === 'ready' ? '已安装' : editing.state === 'installing' ? '安装中' : editing.state === 'failed' ? '安装失败' : '未安装')}</span></div>
          <p className={styles.hint}>{t('仅安装当前工具及其必要依赖。对话和输出文件独立保留。')}</p>
          {editing.state === 'installing' ? <p role="status"><Loader2 className="spin" size={14} /> {t(editing.message)}</p> : null}
          {editing.error && editing.state === 'failed' ? <details><summary>{t('查看错误详情')}</summary><pre className={styles.installError}>{editing.error}</pre></details> : null}
          <div className={styles.runtimeActions}>
            {editing.state === 'ready' ? <>
              {editing.running ? <Button variant="secondary" isDisabled={locked} onPress={() => void mutate(editing, 'stop').catch(value => setFormError(String(value.message || value)))}><Square size={14} />{t('停止')}</Button> : null}
              <Button variant="danger-soft" isDisabled={locked} onPress={() => { setRemoveError(''); setRemoving(editing); }}><Trash2 size={15} />{t('卸载')}</Button>
            </> : <Button isDisabled={locked || editing.state === 'installing'} onPress={() => void install()}>{editing.state === 'installing' ? <Loader2 className="spin" size={15} /> : <Download size={15} />}{t(editing.state === 'failed' ? '重试安装' : '安装')}</Button>}
          </div>
        </section> : null}
        {tab === 'advanced' && editing ? <fieldset disabled={locked || editing.state === 'installing'} className={styles.configuration}>
          <section><div className={styles.sectionHeading}><h3>{t('环境变量')}</h3><Button size="sm" variant="secondary" onPress={() => setRows(current => [...current, { id: crypto.randomUUID(), key: '', original: '', value: '' }])}><Plus size={14} />{t('添加')}</Button></div>
            <p className={styles.hint}>{t('已保存的值不会回显；留空保留原值。保存后，下次调用使用新配置。')}</p>
            {rows.length ? rows.map(row => <div className={styles.environment} key={row.id}>
              <AppInput aria-label={t('环境变量名称')} placeholder="API_KEY" value={row.key} onChange={event => setRows(current => current.map(item => item.id === row.id ? { ...item, key: event.target.value } : item))} />
              <AppInput aria-label={t('环境变量值')} type="password" autoComplete="new-password" placeholder={t(row.original ? '已配置，留空保留' : '值')} value={row.value} onChange={event => setRows(current => current.map(item => item.id === row.id ? { ...item, value: event.target.value } : item))} />
              <Button isIconOnly size="sm" variant="ghost" aria-label={t('移除') + ' ' + row.key} onPress={() => setRows(current => current.filter(item => item.id !== row.id))}><Trash2 size={15} /></Button>
            </div>) : <p className={styles.hint}>{t('尚未设置环境变量')}</p>}
          </section>
          <section><h3>{t('SDK 配置')}</h3><p className={styles.hint}>{t('使用 SDK 的分组配置格式，例如 tools 下对应的工具配置。密钥请通过环境变量引用。')}</p>
            <TextArea aria-label={t('SDK 配置')} rows={8} style={{ minHeight: '12rem' }} spellCheck={false} value={config} onChange={event => setConfig(event.target.value)} className={styles.json} />
          </section>
        </fieldset> : null}
        {formError ? <p role="alert" className={styles.error}>{formError}</p> : null}
      </div>
      {!configurationBusy ? <footer className="ui-modal-footer"><Button variant="secondary" isDisabled={locked} onPress={close}>{t('取消')}</Button><Button isDisabled={locked || editing?.state === 'installing'} onPress={() => void save()}>{locked ? <Loader2 className="spin" size={15} /> : null}{t('保存并关闭')}</Button></footer> : null}
    </AppModal> : null}
    {removing ? <ConfirmDeleteModal id="uninstall-managed-tool" title={t('卸载工具')} itemTitle={t(removing.title)}
      description={t('卸载此工具的程序和依赖。对话、文件和其他工具使用的共享运行环境会保留。')}
      error={removeError} deleting={busy.has(removing.id)} onClose={() => setRemoving(null)} onConfirm={async () => {
        try { await mutate(removing, 'uninstall'); setRemoving(null); }
        catch (value) { setRemoveError(value instanceof Error ? value.message : String(value)); }
      }} /> : null}
  </div>;
}

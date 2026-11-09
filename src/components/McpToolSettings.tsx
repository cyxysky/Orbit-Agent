'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@heroui/react/button';
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, RefreshCw, Search, X } from 'lucide-react';
import type { ConnectorConfigurationState, ConnectorSettingField } from '@cjfclonedeep/capability-sdk/integrations/connectors';
import { AppModal } from '@/components/ui/app-modal';
import { AppInput } from '@/components/ui/app-input';
import { SettingsFieldControl } from '@/components/SettingsFields';
import { WorkspaceContentSkeleton } from '@/components/WorkspaceContentSkeleton';
import { useI18n } from '@/i18n/I18nProvider';
import { readApiJson } from '@/lib/api-client';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';
import { TOOL_CAPABILITY_SETTINGS_CHANGED_EVENT } from '@/lib/tool-capability-settings';
import styles from './McpToolSettings.module.css';

type Target = { id: string; title: string; fieldCount: number; enabled?: boolean; description?: string };
type Detail = { title: string; description?: string; unsupported?: string; writable: boolean;
  fields: ConnectorSettingField[]; state?: ConnectorConfigurationState };
function displayValue(field: ConnectorSettingField, value: unknown) {
  if (value === undefined) return '';
  return field.control === 'select' || field.control === 'json' || field.secret && field.type !== 'string'
    ? JSON.stringify(value, null, 2) : String(value);
}
function initialDraft(detail: Detail) {
  return Object.fromEntries(detail.fields.map(field => [field.key, displayValue(field, detail.state?.values[field.key])]));
}

export function McpToolSettings({ integration, headers, onClose, connection, connectionActions, connectionBusy = false, connectionDirty = false }: {
  integration: { id: string; name: string; enabled?: boolean }; headers: Record<string, string>; onClose: () => void;
  connection?: ReactNode; connectionActions?: ReactNode; connectionBusy?: boolean; connectionDirty?: boolean;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState(connection ? 'connection' : 'tool');
  const scope = tab === 'service' ? 'service' : 'tool';
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<Target[]>([]);
  const [total, setTotal] = useState(0);
  const [target, setTarget] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [changed, setChanged] = useState<string[]>([]);
  const [clearKeys, setClearKeys] = useState<string[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [listError, setListError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [needsReload, setNeedsReload] = useState(false);
  const [reload, setReload] = useState(0);
  const saveAbort = useRef<AbortController | null>(null);
  const dirty = changed.length > 0 || clearKeys.length > 0;
  const locked = saving || dirty || connectionBusy || connectionDirty;
  const endpoint = useMemo(() => withWebPilotBasePath('/api/settings/integrations/configuration'), []);
  useEffect(() => () => saveAbort.current?.abort(), []);
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search); setOffset(0); setTarget(''); }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (tab === 'connection') return;
    const controller = new AbortController();
    setListLoading(true); setListError('');
    const params = new URLSearchParams({ id: integration.id, scope, q: query, offset: String(offset) });
    void fetch(endpoint + '?' + params, { headers, signal: controller.signal, cache: 'no-store' })
      .then(response => readApiJson<{ items: Target[]; total: number }>(response, t('读取 MCP 工具配置失败')))
      .then(data => { if (!controller.signal.aborted) { setItems(data.items); setTotal(data.total); } })
      .catch(error => { if (!controller.signal.aborted) { setItems([]); setListError(error instanceof Error ? error.message : String(error)); } })
      .finally(() => { if (!controller.signal.aborted) setListLoading(false); });
    return () => controller.abort();
  }, [endpoint, headers, integration.id, offset, query, reload, scope, tab, t]);
  useEffect(() => {
    const controller = new AbortController();
    setDetail(null); setDraft({}); setChanged([]); setClearKeys([]); setDetailError(''); setNeedsReload(false);
    if (!target || tab === 'connection') { setDetailLoading(false); return () => controller.abort(); }
    setDetailLoading(true);
    const params = new URLSearchParams({ id: integration.id, scope, target });
    void fetch(endpoint + '?' + params, { headers, signal: controller.signal, cache: 'no-store' })
      .then(response => readApiJson<Detail>(response, t('读取 MCP 工具配置失败')))
      .then(data => { if (!controller.signal.aborted) { setDetail(data); setDraft(initialDraft(data)); } })
      .catch(error => { if (!controller.signal.aborted) setDetailError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [endpoint, headers, integration.id, reload, scope, tab, target, t]);
  function discard() { setDraft(detail ? initialDraft(detail) : {}); setChanged([]); setClearKeys([]); setDetailError(''); }
  async function toggle(item: Target) {
    setPending(current => new Set(current).add(item.id)); setListError('');
    try {
      const data = await readApiJson<{ enabled: boolean }>(await fetch(endpoint, {
        method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ id: integration.id, action: 'set-enabled', target: item.id, enabled: item.enabled === false }),
      }), t('保存 MCP 工具配置失败'));
      setItems(current => current.map(tool => tool.id === item.id ? { ...tool, enabled: data.enabled } : tool));
      window.dispatchEvent(new Event(TOOL_CAPABILITY_SETTINGS_CHANGED_EVENT));
    } catch (error) { setListError(error instanceof Error ? error.message : String(error)); }
    finally { setPending(current => { const next = new Set(current); next.delete(item.id); return next; }); }
  }
  async function save() {
    if (!detail?.state || !detail.writable || saving || needsReload) return;
    setDetailError('');
    const values: Record<string, unknown> = {};
    try {
      for (const key of changed) {
        const field = detail.fields.find(field => field.key === key)!;
        const raw = draft[key] ?? '';
        if (field.secret && !raw) continue;
        if (field.control === 'number' && !raw.trim()) throw new Error(t('数字字段不能为空；使用清除按钮移除默认值。'));
        try { values[key] = field.control === 'select' || field.control === 'json' || field.secret && field.type !== 'string'
          ? JSON.parse(raw) : field.control === 'boolean' ? raw === 'true' : field.control === 'number' ? Number(raw) : raw; }
        catch { throw new Error(t('{name} 需要有效的 JSON 值。', { name: field.label })); }
        if (typeof values[key] === 'number' && !Number.isFinite(values[key])) throw new Error(t('请输入有效数字。'));
      }
    } catch (error) { setDetailError(error instanceof Error ? error.message : String(error)); return; }
    const controller = new AbortController(); saveAbort.current = controller; setSaving(true);
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ id: integration.id, scope, target, values, clearKeys, expectedRevision: detail.state.revision }) });
      const data = await readApiJson<{ state: ConnectorConfigurationState }>(response, t('保存 MCP 工具配置失败'));
      const next = { ...detail, state: data.state };
      setDetail(next); setDraft(initialDraft(next)); setChanged([]); setClearKeys([]);
    } catch (error) {
      if (!controller.signal.aborted) { setDetailError(error instanceof Error ? error.message : String(error)); setNeedsReload(true); }
    } finally { if (!controller.signal.aborted) setSaving(false); }
  }
  function editor() {
    return <section className={styles.editor} aria-busy={detailLoading} aria-label={t('配置字段')}>
      {detailLoading ? <WorkspaceContentSkeleton label={t('正在读取配置')} /> : detail ? <>
        {detail.description ? <p className={styles.description}>{detail.description}</p> : null}
        {detail.unsupported ? <p className={styles.status}>{t(detail.unsupported)}</p> : !detail.fields.length ? <p className={styles.status}>{t('没有可配置的字段')}</p>
          : detail.fields.map(field => {
            const configured = detail.state && (Object.hasOwn(detail.state.values, field.key) || detail.state.configuredSecrets.includes(field.key));
            const clearing = clearKeys.includes(field.key);
            return <div key={field.key} className={styles.field}>
              <div className={styles.fieldHeading}><strong>{field.label}</strong><span>{t(clearing ? '待清除' : changed.includes(field.key) ? '未保存' : configured ? '已配置' : '未设置')}</span>
                {detail.writable && (configured || changed.includes(field.key)) ? <button type="button" disabled={saving || needsReload} className="external-integration-clear-field" onClick={() => {
                  setChanged(keys => keys.filter(key => key !== field.key)); setClearKeys(keys => [...new Set([...keys, field.key])]); setDraft(current => ({ ...current, [field.key]: '' }));
                }}>{t('清除')}</button> : null}</div>
              <SettingsFieldControl field={{ ...field, required: scope === 'service' && field.required }} value={draft[field.key]}
                disabled={saving || needsReload || !detail.writable} secretPreview={configured && field.secret && !clearing ? '••••••••' : undefined}
                onChange={value => { setDraft(current => ({ ...current, [field.key]: value })); setChanged(keys => [...new Set([...keys, field.key])]); setClearKeys(keys => keys.filter(key => key !== field.key)); }} />
              {field.description ? <small>{field.description}</small> : null}
              {field.secret && field.type !== 'string' ? <small>{t('此字段包含敏感值，请输入完整 JSON；留空保留已保存值。')}</small> : null}
            </div>;
          })}
      </> : null}
      {detailError ? <p className="external-integration-error" role="alert">{detailError}</p> : null}
    </section>;
  }
  return <AppModal ariaLabel={integration.name + ' · ' + t('MCP 配置')} size="wide" dialogClassName={styles.modal}
    dismissable={!locked && !pending.size} keyboardDismissable={!locked && !pending.size} onClose={() => { if (!locked && !pending.size) onClose(); }}>
    <header className="ui-modal-header"><h2 className="ui-modal-title">{integration.name} · {t('MCP 配置')}</h2>
      <button type="button" aria-label={t('关闭')} className="ui-icon-button ui-modal-close" disabled={locked || Boolean(pending.size)} onClick={onClose}><X size={16} /></button>
    </header>
    <div className={styles.tabs} role="tablist" aria-label={t('MCP 配置分组')}>
      {[...(connection ? [{ id: 'connection', title: '连接' }] : []), { id: 'tool', title: '服务内工具' }, { id: 'service', title: '服务配置' }].map(item =>
        <button type="button" key={item.id} role="tab" aria-selected={tab === item.id} disabled={locked || Boolean(pending.size)}
          onClick={() => { setTab(item.id); setTarget(''); setSearch(''); setQuery(''); setOffset(0); }}>{t(item.title)}</button>)}
    </div>
    {tab === 'connection' ? connection : <div className={'ui-modal-body ' + styles.body}>
      <p className={styles.hint}>{t(scope === 'tool'
        ? integration.enabled === false ? '服务已停用。工具选择会保留，开启服务后按此设置生效。' : '每个工具可独立启停；展开后配置调用参数默认值。'
        : '仅展示 MCP 服务主动声明的配置接口；保存后的生效方式由服务决定。')}</p>
      <AppInput aria-label={t('搜索工具')} prefix={<Search size={15} />} placeholder={t('搜索工具')} value={search} disabled={locked} onChange={event => setSearch(event.target.value)} />
      {listLoading ? <WorkspaceContentSkeleton label={t('正在读取配置')} /> : <div className={styles.targets}>
        {items.length ? items.map(item => <section key={item.id} className={styles.operation}>
          <div className={styles.operationRow}>
            <button type="button" disabled={locked} className={styles.target} aria-expanded={target === item.id}
              onClick={() => setTarget(current => current === item.id ? '' : item.id)}>
              <ChevronDown size={15} className={target === item.id ? styles.expanded : ''} />
              <span><strong>{item.title}</strong><small>{item.id}</small></span>
            </button>
            {scope === 'tool' ? <SettingsFieldControl field={{ key: item.id, label: t('启用') + ' ' + item.title, control: 'boolean' }} value={item.enabled !== false}
              disabled={locked || pending.has(item.id)} onChange={() => void toggle(item)} /> : null}
          </div>
          {target === item.id ? editor() : null}
        </section>) : <p className={styles.status}>{t(query ? '没有匹配的工具' : scope === 'service' ? '此服务未声明配置接口' : '此服务未提供工具')}</p>}
      </div>}
      {listError ? <p role="alert" className="external-integration-error">{listError}</p> : null}
      <div className={styles.pagination}>
        <Button isIconOnly size="sm" variant="ghost" aria-label={t('上一页')} isDisabled={locked || listLoading || offset === 0} onPress={() => { setOffset(Math.max(0, offset - 20)); setTarget(''); }}><ChevronLeft size={16} /></Button>
        <span>{total ? String(Math.floor(offset / 20) + 1) + ' / ' + String(Math.ceil(total / 20)) : '0 / 0'}</span>
        <Button isIconOnly size="sm" variant="ghost" aria-label={t('下一页')} isDisabled={locked || listLoading || offset + 20 >= total} onPress={() => { setOffset(offset + 20); setTarget(''); }}><ChevronRight size={16} /></Button>
      </div>
    </div>}
    {tab === 'connection' ? connectionActions : <footer className="ui-modal-footer">
      <span className={styles.footerHint}>{dirty ? t('保存或放弃当前修改后再切换。') : t('工具开关即时保存，参数默认值需要点击保存。')}</span>
      {dirty && !needsReload ? <Button variant="secondary" isDisabled={saving} onPress={discard}>{t('放弃修改')}</Button> : null}
      <Button variant="secondary" isDisabled={saving || dirty && !needsReload} onPress={() => setReload(value => value + 1)}><RefreshCw size={14} />{t('重新加载')}</Button>
      <Button isDisabled={!detail?.writable || !dirty || saving || needsReload} onPress={() => void save()}>{saving ? <Loader2 className="spin" size={14} /> : null}{t('保存')}</Button>
    </footer>}
  </AppModal>;
}

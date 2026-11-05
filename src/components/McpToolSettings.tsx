'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Search, X } from 'lucide-react';
import type { ConnectorConfigurationState, ConnectorSettingField } from '@cjfclonedeep/capability-sdk/integrations/connectors';
import { AppModal } from '@/components/ui/app-modal';
import { AppInput } from '@/components/ui/app-input';
import { SettingsFieldControl } from '@/components/SettingsFields';
import { useI18n } from '@/i18n/I18nProvider';
import { readApiJson } from '@/lib/api-client';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';
import styles from './McpToolSettings.module.css';

type Target = { id: string; title: string; fieldCount: number };
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

export function McpToolSettings({ integration, headers, onClose }: {
  integration: { id: string; name: string }; headers: Record<string, string>; onClose: () => void;
}) {
  const { t } = useI18n();
  const [scope, setScope] = useState<'tool' | 'service'>('tool');
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
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [listError, setListError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [needsReload, setNeedsReload] = useState(false);
  const [reload, setReload] = useState(0);
  const saveAbort = useRef<AbortController | null>(null);
  const dirty = changed.length > 0 || clearKeys.length > 0;
  const locked = saving || dirty;
  const endpoint = useMemo(() => withWebPilotBasePath('/api/settings/integrations/configuration'), []);
  useEffect(() => () => saveAbort.current?.abort(), []);
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search); setOffset(0); }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    setListLoading(true); setListError('');
    const params = new URLSearchParams({ id: integration.id, scope, q: query, offset: String(offset) });
    void fetch(`${endpoint}?${params}`, { headers, signal: controller.signal, cache: 'no-store' })
      .then(response => readApiJson<{ items: Target[]; total: number }>(response, t('读取 MCP 工具配置失败')))
      .then(data => { if (!controller.signal.aborted) { setItems(data.items); setTotal(data.total); } })
      .catch(error => { if (!controller.signal.aborted) { setItems([]); setListError(error instanceof Error ? error.message : String(error)); } })
      .finally(() => { if (!controller.signal.aborted) setListLoading(false); });
    return () => controller.abort();
  }, [endpoint, headers, integration.id, offset, query, reload, scope, t]);
  useEffect(() => {
    const controller = new AbortController();
    setDetail(null); setDraft({}); setChanged([]); setClearKeys([]); setDetailError(''); setNeedsReload(false);
    if (!target) { setDetailLoading(false); return () => controller.abort(); }
    setDetailLoading(true);
    const params = new URLSearchParams({ id: integration.id, scope, target });
    void fetch(`${endpoint}?${params}`, { headers, signal: controller.signal, cache: 'no-store' })
      .then(response => readApiJson<Detail>(response, t('读取 MCP 工具配置失败')))
      .then(data => { if (!controller.signal.aborted) { setDetail(data); setDraft(initialDraft(data)); } })
      .catch(error => { if (!controller.signal.aborted) setDetailError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [endpoint, headers, integration.id, reload, scope, target, t]);
  function discard() {
    setDraft(detail ? initialDraft(detail) : {}); setChanged([]); setClearKeys([]); setDetailError('');
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
  return <AppModal ariaLabelledBy="mcp-tool-settings-title" size="wide" dialogClassName={`ui-modal ui-modal--form ${styles.modal}`}
    dismissable={!locked} keyboardDismissable={!locked} onClose={() => { if (!locked) onClose(); }}>
    <header className="ui-modal-header">
      <div className="ui-modal-heading-copy"><h2 className="ui-modal-title" id="mcp-tool-settings-title">{integration.name} · {t('工具设置')}</h2></div>
      <button type="button" aria-label={t('关闭')} className="ui-icon-button ui-modal-close" disabled={locked} onClick={onClose}><X size={16} /></button>
    </header>
    <div className={`ui-modal-body ${styles.body}`}>
      <div className={styles.tabs} role="group" aria-label={t('配置范围')}>
        {(['tool', 'service'] as const).map(value => <button type="button" key={value} disabled={locked} aria-pressed={scope === value}
          onClick={() => { setScope(value); setTarget(''); setSearch(''); setQuery(''); setOffset(0); }}>{t(value === 'tool' ? '工具参数默认值' : '服务配置')}</button>)}
      </div>
      <p className={styles.hint}>{t(scope === 'tool' ? '默认值随每次工具调用下发，模型明确传入的参数优先。' : '仅展示 MCP 服务主动声明的配置接口；保存后的生效方式由服务决定。')}</p>
      <div className={styles.workspace}>
        <aside className={styles.navigation} aria-label={t('MCP 工具')}>
          <AppInput aria-label={t('搜索工具')} prefix={<Search size={15} />} placeholder={t('搜索工具')} value={search} disabled={locked} onChange={event => setSearch(event.target.value)} />
          <div className={styles.targets} aria-busy={listLoading}>
            {listLoading ? <p className={styles.status} role="status"><Loader2 className="spin" size={16} />{t('正在读取配置')}</p>
              : listError ? <p role="alert" className="external-integration-error">{listError}</p>
              : items.length ? items.map(item => <button type="button" key={item.id} disabled={locked} aria-pressed={target === item.id}
                className={styles.target} onClick={() => setTarget(item.id)}><strong>{item.title}</strong><span>{item.id}</span></button>)
              : <p className={styles.status}>{t(query ? '没有匹配的工具' : scope === 'service' ? '此服务未声明配置接口' : '此服务未提供工具')}</p>}
          </div>
          <div className={styles.pagination}>
            <button className="ui-icon-button" type="button" aria-label={t('上一页')} disabled={locked || listLoading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}><ChevronLeft size={16} /></button>
            <span>{total ? `${Math.floor(offset / 20) + 1} / ${Math.ceil(total / 20)}` : '0 / 0'}</span>
            <button className="ui-icon-button" type="button" aria-label={t('下一页')} disabled={locked || listLoading || offset + 20 >= total} onClick={() => setOffset(offset + 20)}><ChevronRight size={16} /></button>
          </div>
        </aside>
        <section className={styles.editor} aria-busy={detailLoading} aria-label={t('配置字段')}>
          {detailLoading ? <p className={styles.status} role="status"><Loader2 className="spin" size={16} />{t('正在读取配置')}</p> : detail ? <>
            <h3>{detail.title}</h3>
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
          </> : !detailError ? <p className={styles.status}>{t('选择一个工具查看配置')}</p> : null}
          {detailError ? <p className="external-integration-error" role="alert">{detailError}</p> : null}
        </section>
      </div>
    </div>
    <footer className="ui-modal-footer">
      <span className={styles.footerHint}>{dirty ? t('保存或放弃当前修改后再切换。') : t('敏感值不会回传；留空保留，清除后保存才会删除。')}</span>
      {dirty && !needsReload ? <button type="button" className="ui-button ui-button--neutral" disabled={saving} onClick={discard}>{t('放弃修改')}</button> : null}
      <button type="button" className="ui-button ui-button--neutral" disabled={saving || dirty && !needsReload} onClick={() => setReload(value => value + 1)}><RefreshCw size={14} />{t('重新加载')}</button>
      <button type="button" className="ui-button ui-button--primary" disabled={!detail?.writable || !dirty || saving || needsReload} onClick={() => void save()}>{saving ? <Loader2 className="spin" size={14} /> : null}{t(saving ? '正在保存' : '保存')}</button>
    </footer>
  </AppModal>;
}

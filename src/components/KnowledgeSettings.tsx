'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Download, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react';
import type { KnowledgePackageSummary } from '@cjfclonedeep/capability-sdk/knowledge';
import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { useI18n } from '@/i18n/I18nProvider';
import { readApiJson } from '@/lib/api-client';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';
import './KnowledgeSettings.css';

const endpoint = '/api/settings/knowledge';
export function KnowledgeSettings() {
  const { t } = useI18n();
  const fileInput = useRef<HTMLInputElement>(null);
  const [packages, setPackages] = useState<KnowledgePackageSummary[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<KnowledgePackageSummary | null>(null);
  const load = useCallback(async (offset = 0) => {
    setLoading(true);
    try {
      const response = await fetch(withWebPilotBasePath(endpoint + '?limit=50&offset=' + offset), { cache: 'no-store' });
      const data = await readApiJson<{ packages: KnowledgePackageSummary[]; nextOffset: number | null }>(response, t('读取知识库失败'));
      setPackages(current => offset ? [...current, ...data.packages] : data.packages);
      setNextOffset(data.nextOffset);
    } finally { setLoading(false); }
  }, [t]);
  useEffect(() => { void load().catch(reason => setError(reason instanceof Error ? reason.message : t('读取知识库失败'))); }, [load, t]);

  async function downloadTemplate() {
    setBusy('template'); setError('');
    try {
      const response = await fetch(withWebPilotBasePath(endpoint + '?template=1'), { cache: 'no-store' });
      if (!response.ok) { await readApiJson(response, t('下载模板失败')); return; }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'orbit-knowledge-package-template.zip';
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('下载模板失败')); }
    finally { setBusy(''); }
  }
  async function importFile(file: File) {
    setError(''); setNotice('');
    if (file.size > 32 * 1024 * 1024) { setError(t('知识包不能超过 32 MB。')); return; }
    if (!/\.(zip|rar)$/i.test(file.name)) { setError(t('请选择 ZIP 或 RAR 知识包。')); return; }
    setBusy('import');
    try {
      const body = new FormData(); body.append('file', file);
      const response = await fetch(withWebPilotBasePath(endpoint), { method: 'POST', body });
      const data = await readApiJson<{ package: KnowledgePackageSummary }>(response, t('导入知识包失败'));
      await load();
      setNotice(t('已导入 {name}，共 {count} 条记录。', { name: data.package.name, count: data.package.recordCount })
        + ' ' + t(data.package.enabled ? '已启用，Agent 将按需检索。' : '当前包保持停用，可手动启用。'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('导入知识包失败')); }
    finally { setBusy(''); }
  }
  async function toggle(pack: KnowledgePackageSummary) {
    setBusy(pack.id); setError(''); setNotice('');
    try {
      const response = await fetch(withWebPilotBasePath(endpoint), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: pack.id, enabled: !pack.enabled }) });
      await readApiJson(response, t('更新知识包失败')); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('更新知识包失败')); }
    finally { setBusy(''); }
  }
  async function remove() {
    if (!deleteTarget) return;
    setBusy('delete'); setError('');
    try {
      const response = await fetch(withWebPilotBasePath(endpoint + '?id=' + encodeURIComponent(deleteTarget.id)), { method: 'DELETE' });
      await readApiJson(response, t('删除知识包失败'));
      setDeleteTarget(null); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('删除知识包失败')); }
    finally { setBusy(''); }
  }
  return (
    <section className="knowledge-settings settings-scroll-page">
      <header className="knowledge-settings-header">
        <div><h2><BookOpen size={20} />{t('知识库')}</h2><p>{t('导入有来源的业务规则和手册，Agent 在相关任务中按需读取。')}</p></div>
        <div className="knowledge-settings-actions">
          <button className="ui-button" disabled={!!busy} onClick={() => void downloadTemplate()} type="button"><Download size={15} />{t('下载导入模板')}</button>
          <button className="ui-button" disabled={!!busy || loading} onClick={() => { setError(''); void load().catch(reason => setError(String(reason))); }} type="button"><RefreshCw size={15} />{t('刷新')}</button>
          <button className="ui-button" disabled={!!busy} onClick={() => fileInput.current?.click()} type="button">
            {busy === 'import' ? <Loader2 className="spin" size={15} /> : <Upload size={15} />}{t(busy === 'import' ? '正在导入' : '导入知识包')}
          </button>
          <input accept=".zip,.rar,application/zip,application/x-rar-compressed,application/vnd.rar" aria-label={t('选择知识包')} hidden ref={fileInput} type="file"
            onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFile(file); }} />
        </div>
      </header>
      <div className="knowledge-settings-help">
        <p>{t('支持 ZIP、RAR。下载模板可获取清单、字段定义、JSONL 示例和生成说明。同一包 ID 的新导入会替换现有内容。')}</p>
        <p>{t('原包、知识正文和索引保存在当前 Orbit 部署的数据目录，按用户隔离，不自动提交或上传 GitHub。检索到的内容会按当前模型配置发送给模型。')}</p>
      </div>
      {busy === 'import' ? <p role="status">{t('正在校验内容、来源和关联，并建立索引。完成后自动启用；包内脚本不会执行。')}</p> : null}
      {notice ? <p className="knowledge-settings-notice" role="status">{notice}</p> : null}
      {error && !deleteTarget ? <p className="knowledge-settings-error" role="alert">{error}</p> : null}
      {loading && !packages.length ? <p role="status"><Loader2 className="spin" size={16} /> {t('正在读取知识库')}</p> : null}
      {!loading && !packages.length ? <div className="knowledge-settings-empty"><BookOpen size={28} /><strong>{t('还没有知识包')}</strong><span>{t('先下载模板准备内容，或直接导入符合格式的业务知识包。')}</span></div> : null}
      <div className="knowledge-package-list">
        {packages.map(pack => (
          <article className="knowledge-package-card" key={pack.id}>
            <div className="knowledge-package-heading"><div><h3>{pack.name}</h3><p>{pack.description}</p></div>
              <div className="knowledge-settings-actions">
                <button aria-checked={pack.enabled} className="ui-button" disabled={!!busy} onClick={() => void toggle(pack)} role="switch" type="button">{t(pack.enabled ? '已启用' : '已停用')}</button>
                <button aria-label={t('删除知识包')} className="ui-icon-button" disabled={!!busy} onClick={() => { setError(''); setDeleteTarget(pack); }} type="button"><Trash2 size={15} /></button>
              </div>
            </div>
            <dl><div><dt>{t('包 ID')}</dt><dd>{pack.id}</dd></div><div><dt>{t('版本')}</dt><dd>{pack.version}</dd></div><div><dt>{t('记录')}</dt><dd>{pack.recordCount}</dd></div><div><dt>{t('导入时间')}</dt><dd>{new Date(pack.importedAt).toLocaleString()}</dd></div></dl>
            {pack.domains.length ? <p className="knowledge-package-domains">{pack.domains.join(' · ')}</p> : null}
          </article>
        ))}
      </div>
      {nextOffset !== null ? <button className="ui-button" disabled={!!busy || loading} onClick={() => void load(nextOffset).catch(reason => setError(String(reason)))} type="button">{t('加载更多')}</button> : null}
      {deleteTarget ? <ConfirmDeleteModal deleting={busy === 'delete'} description={t('删除此包的原始压缩包、正文和索引，Agent 将无法继续查询该包。')} error={error}
        id="knowledge-package-delete" itemTitle={deleteTarget.name} onClose={() => { if (!busy) { setDeleteTarget(null); setError(''); } }} onConfirm={remove} title={t('删除知识包')} /> : null}
    </section>
  );
}

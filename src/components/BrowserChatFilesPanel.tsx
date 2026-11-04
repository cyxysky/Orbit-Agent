'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { Button } from '@heroui/react/button';
import { Download, Eye, Files, FolderOpen, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { AppInput } from '@/components/ui/app-input';
import { AppModal } from '@/components/ui/app-modal';
import { ExpandableActionLabel } from '@/components/ui/expandable-action-label';
import { FileTypeIcon } from '@/components/FileTypeIcon';
import { useFilePreview } from '@/components/file-preview-context';
import { browserChatArtifactDownloadUrl, browserChatArtifactKey, browserChatArtifactOpenUrl, type BrowserChatMessageFileGroup } from '@/lib/browser-chat-artifacts';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';
import '@/app/styles/domains/conversation-files.css';


export function BrowserChatFilesPanel({ sessionId, busy }: {
  sessionId: string; busy: boolean;
}) {
  const { t, language } = useI18n();
  const { openFilePreview, filePreviewOpen } = useFilePreview();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<BrowserChatMessageFileGroup[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    void (async () => {
      try {
        const response = await fetch(withWebPilotBasePath(`/api/browser-chat/${encodeURIComponent(sessionId)}/files`), { cache: 'no-store', signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new CodedError(ERROR_CODES.APPLICATION_ERROR, data.error?.message || t('读取对话文件失败'));
        if (!controller.signal.aborted) setGroups(data.groups);
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : t('读取对话文件失败')); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [open, refresh, busy, sessionId, t]);
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return groups.flatMap(group => {
      const files = !search || group.title.toLocaleLowerCase().includes(search) ? group.files
        : group.files.filter(file => `${file.fileName} ${file.title || ''}`.toLocaleLowerCase().includes(search));
      return files.length ? [{ ...group, files }] : [];
    });
  }, [groups, query]);
  const selected = filtered.find(group => group.messageId === selectedId) || filtered[0];
  const count = groups.reduce((total, group) => total + group.files.length, 0);
  const time = (value: string) => Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat(language, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '—';
  const size = (bytes?: number) => {
    if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—';
    const unit = Math.min(3, Math.max(0, Math.floor(Math.log2(bytes || 1) / 10)));
    return `${new Intl.NumberFormat(language, { maximumFractionDigits: unit ? 1 : 0 }).format(bytes / 1024 ** unit)} ${['B', 'KB', 'MB', 'GB'][unit]}`;
  };
  return <>
    <Button type="button" variant="ghost" className="browser-chat-conversation-direct-action" aria-label={t('对话文件管理')} aria-haspopup="dialog" aria-expanded={open} onPress={() => setOpen(true)}>
      <Files size={17} aria-hidden="true" /><ExpandableActionLabel>{t('对话文件')}</ExpandableActionLabel>
    </Button>
    <AppModal ariaLabelledBy={titleId} dialogClassName="conversation-files-dialog" size="lg"
      open={open && !filePreviewOpen} dismissable={!filePreviewOpen} keyboardDismissable={!filePreviewOpen}
      onClose={() => { if (!filePreviewOpen) setOpen(false); }}>
        <header className="conversation-files-header">
          <h2 className="conversation-files-title" id={titleId}><Files size={18} aria-hidden="true" />{t('对话文件')}<span>{t('{count} 个文件', { count })}</span></h2>
          <button type="button" className="conversation-files-icon-button" disabled={loading} aria-label={t('刷新文件')} title={t('刷新文件')} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          <button type="button" className="conversation-files-icon-button" aria-label={t('关闭文件管理')} onClick={() => setOpen(false)}><X size={18} /></button>
        </header>
        <div className="ui-modal-body conversation-files-body">
          <div className="conversation-files-search"><AppInput aria-label={t('搜索消息或文件')} placeholder={t('搜索消息或文件…')} value={query} onChange={event => setQuery(event.target.value)} prefix={<Search size={16} />} /></div>
          {error ? <div className="conversation-files-empty" role="alert"><p>{error}</p><button type="button" className="ui-button" onClick={() => setRefresh(value => value + 1)}>{t('重试')}</button></div>
            : loading && !groups.length ? <div className="conversation-files-empty" role="status"><Loader2 size={24} className="animate-spin" /><p>{t('正在读取对话文件…')}</p></div>
              : !filtered.length ? <div className="conversation-files-empty"><FolderOpen size={30} /><h3>{t(query ? '未找到匹配的文件' : '暂无最终交付文件')}</h3><p>{t(query ? '试试消息内容或文件名称' : '最终回复中交付的文件会显示在这里')}</p></div>
                : <div className="conversation-files-columns" aria-busy={loading}>
                  <nav className="conversation-files-messages" aria-label={t('产出文件的消息')}>
                    <div className="conversation-files-nav-heading"><span>{t('消息')}</span><span>{filtered.length}</span></div>
                    <ol>{filtered.map(group => <li key={group.messageId}><button type="button" className={`conversation-files-message${selected?.messageId === group.messageId ? ' is-selected' : ''}`}
                      title={group.title} aria-current={selected?.messageId === group.messageId ? 'true' : undefined} onClick={() => setSelectedId(group.messageId)}>
                      <strong>{group.title}</strong><span><time dateTime={group.createdAt}>{time(group.createdAt)}</time><span>{t('{count} 个文件', { count: group.files.length })}</span></span>
                    </button></li>)}</ol>
                  </nav>
                  <section className="conversation-files-results" aria-label={selected?.title || t('文件')}>
                    <header><h3>{selected?.title}</h3><span><time dateTime={selected?.createdAt}>{selected && time(selected.createdAt)}</time><span>·</span>{t('{count} 个文件', { count: selected?.files.length || 0 })}</span></header>
                    <div className="conversation-files-column-labels" aria-hidden="true"><span>{t('文件')}</span><span>{t('大小')}</span><span>{t('操作')}</span></div>
                    <ul className="conversation-files-list">{selected?.files.map(file => {
                      const source = browserChatArtifactOpenUrl(file)!;
                      const preview = () => openFilePreview({ fileName: file.fileName, source });
                      return <li className="conversation-files-file" key={browserChatArtifactKey(file)}>
                        <button type="button" className="conversation-files-file-main" title={file.fileName} onClick={preview}>
                          <span className="conversation-files-file-icon"><FileTypeIcon fileName={file.fileName} size={24} /></span>
                          <span><strong>{file.fileName}</strong><small>{file.fileName.split('.').at(-1)?.toUpperCase()}{file.pageCount ? ` · ${t('{count} 页', { count: file.pageCount })}` : ''}<span className="conversation-files-mobile-size"> · {size(file.bytes)}</span></small></span>
                        </button>
                        <span className="conversation-files-size">{size(file.bytes)}</span>
                        <div className="conversation-files-actions"><button type="button" className="conversation-files-icon-button" aria-label={t('预览文件 {name}', { name: file.fileName })} title={t('预览')} onClick={preview}><Eye size={16} /></button><a href={browserChatArtifactDownloadUrl(file)} download={file.fileName} data-file-preview="false" className="conversation-files-icon-button" aria-label={t('下载文件 {name}', { name: file.fileName })} title={t('下载文件')}><Download size={16} /></a></div>
                      </li>;
                    })}</ul>
                  </section>
                </div>}
        </div>
    </AppModal>
  </>;
}

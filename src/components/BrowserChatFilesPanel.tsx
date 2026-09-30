'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@heroui/react/button';
import { Popover } from '@heroui/react/popover';
import { Download, Files, FolderOpen, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { AppInput } from '@/components/ui/app-input';
import { FileTypeIcon } from '@/components/FileTypeIcon';
import { useFilePreview } from '@/components/FilePreviewProvider';
import { WorkspaceHistoryList } from '@/components/WorkspaceSidebarArchive';
import { browserChatArtifactKey, browserChatArtifactOpenUrl, type BrowserChatMessageFileGroup } from '@/lib/browser-chat-artifacts';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';

export function BrowserChatFilesPanel({ sessionId, busy }: {
  sessionId: string; busy: boolean;
}) {
  const { t, language } = useI18n();
  const { openFilePreview } = useFilePreview();
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
        if (!response.ok) throw new Error(data.error?.message || t('读取对话文件失败'));
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
  const time = (value: string) => new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
  return <Popover isOpen={open} onOpenChange={setOpen}>
    <Button type="button" variant="ghost" className="browser-chat-conversation-direct-action" aria-label={t('对话文件管理')} aria-expanded={open}>
      <Files size={17} aria-hidden="true" /><span className="browser-chat-files-trigger-label">{t('对话文件')}</span>
    </Button>
    <Popover.Content className="browser-chat-files-popover" placement="bottom end" offset={10} containerPadding={12}>
      <Popover.Dialog aria-label={t('对话文件管理')} className="browser-chat-files-dialog">
        <header className="browser-chat-files-header">
          <span className="browser-chat-files-heading-icon"><Files size={20} /></span>
          <div><strong>{t('对话文件')}</strong><small>{t('当前对话')} · {t('{count} 条消息', { count: groups.length })} · {t('{count} 个文件', { count })}</small></div>
          <button type="button" className="ui-icon-button" disabled={loading} aria-label={t('刷新文件')} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button>
          <button type="button" className="ui-icon-button" aria-label={t('关闭文件管理')} onClick={() => setOpen(false)}><X size={17} /></button>
        </header>
        <div className="browser-chat-files-search"><AppInput aria-label={t('搜索消息或文件')} placeholder={t('搜索消息或文件…')} value={query} onChange={event => setQuery(event.target.value)} prefix={<Search size={16} />} /></div>
        {error ? <div className="browser-chat-files-empty" role="alert"><p>{error}</p><button type="button" className="ui-button" onClick={() => setRefresh(value => value + 1)}>{t('重试')}</button></div>
          : loading && !groups.length ? <div className="browser-chat-files-empty" role="status"><Loader2 size={24} className="animate-spin" /><p>{t('正在读取对话文件…')}</p></div>
            : !filtered.length ? <div className="browser-chat-files-empty"><FolderOpen size={32} /><strong>{t(query ? '未找到匹配的文件' : '还没有产出文件')}</strong><p>{t(query ? '试试消息内容或文件名称' : '当前对话中生成的文件会自动汇集在这里')}</p></div>
              : <div className="browser-chat-files-columns" aria-busy={loading}>
                <nav className="browser-chat-files-messages" aria-label={t('产出文件的消息')}>
                  <WorkspaceHistoryList items={filtered} language={language} compactGroupHeaders
                    className="browser-chat-files-message-history" getKey={group => group.messageId}
                    renderItem={group => <button type="button" className={`browser-chat-files-message${selected?.messageId === group.messageId ? ' is-selected' : ''}`}
                      title={group.title} aria-pressed={selected?.messageId === group.messageId} onClick={() => setSelectedId(group.messageId)}>
                      <strong>{group.title}</strong>
                      <time dateTime={group.createdAt}>{time(group.createdAt)}</time>
                    </button>} />
                </nav>
                <section className="browser-chat-files-results" aria-label={selected?.title || t('文件')}>
                  <header><strong title={selected?.title}>{selected?.title}</strong><span>{t('{count} 个文件', { count: selected?.files.length || 0 })}</span></header>
                  <div className="browser-chat-files-list">
                    {selected?.files.map(file => {
                      const source = browserChatArtifactOpenUrl(file)!;
                      return <article className="browser-chat-files-file" key={browserChatArtifactKey(file)}>
                        <button type="button" className="browser-chat-files-file-main" title={file.fileName} onClick={() => { setOpen(false); openFilePreview({ fileName: file.fileName, source }); }}>
                          <span className="browser-chat-files-file-icon"><FileTypeIcon fileName={file.fileName} size={26} /></span>
                          <span><strong>{file.fileName}</strong><small>{file.fileName.split('.').at(-1)?.toUpperCase()} {typeof file.bytes === 'number' ? `· ${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(file.bytes / 1024)} KB` : ''}{file.pageCount ? ` · ${t('{count} 页', { count: file.pageCount })}` : ''}</small></span>
                        </button>
                        <a href={file.downloadUrl || source} download={file.fileName} data-file-preview="false" className="browser-chat-files-download" aria-label={t('下载文件 {name}', { name: file.fileName })} title={t('下载文件')}><Download size={16} /></a>
                      </article>;
                    })}
                  </div>
                </section>
              </div>}
        <footer className="browser-chat-files-footer"><span>{t('当前对话 · 按消息归档')}</span><span>{t('点击文件即可预览')}</span></footer>
      </Popover.Dialog>
    </Popover.Content>
  </Popover>;
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { ExpandableActionLabel } from './ui/expandable-action-label';

export function BrowserChatExportButton({ sessionId, onError }: { sessionId: string; onError: (message: string) => void }) {
  const { t, language } = useI18n();
  const controller = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState('');
  useEffect(() => () => controller.current?.abort(), []);
  async function exportConversation() {
    if (controller.current) { controller.current.abort(); return; }
    const task = new AbortController();
    controller.current = task;
    setProgress(t('正在读取完整对话…'));
    try {
      const { exportBrowserChatHtml } = await import('./browser-chat-export');
      await exportBrowserChatHtml({ sessionId, locale: language, signal: task.signal,
        onProgress: text => { if (!task.signal.aborted) setProgress(t(text)); } });
    } catch (error) {
      if (!task.signal.aborted) onError(error instanceof Error ? error.message : t('导出对话失败'));
    } finally {
      if (controller.current === task) { controller.current = null; setProgress(''); }
    }
  }
  return <button type="button" className="browser-chat-conversation-direct-action" onClick={() => void exportConversation()}
    aria-label={progress ? `${progress} · ${t('取消导出')}` : t('导出完整对话为 HTML')}
    title={progress ? `${progress} · ${t('点击取消')}` : t('导出 HTML，包含图片、画布和文件')}>
    {progress ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : <FileDown size={17} aria-hidden="true" />}
    <ExpandableActionLabel>{t(progress ? '取消导出' : '导出 HTML')}</ExpandableActionLabel>
    <span className="sr-only" role="status">{progress}</span>
  </button>;
}

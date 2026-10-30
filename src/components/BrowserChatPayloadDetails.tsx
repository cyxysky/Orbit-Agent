'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { BrowserChatCodeViewer } from '@/components/BrowserChatCodeViewer';
import { useI18n } from '@/i18n/I18nProvider';

export function BrowserChatPayloadDetails({
  className = '',
  defaultOpen = false,
  payload,
  title,
}: {
  className?: string;
  defaultOpen?: boolean;
  payload: string;
  title: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const [wrap, setWrap] = useState(true);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  if (!payload) return null;
  return (
    <details className={`browser-chat-payload-details ${className}`} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{title}</summary>
      {open ? <div className="browser-chat-payload-content">
        <div className="browser-chat-tool-output-actions">
          <span>{t('自动换行')}</span>
          <button aria-checked={wrap} aria-label={t('切换自动换行')} className="browser-chat-tool-wrap-toggle" onClick={() => setWrap(current => !current)} role="switch" type="button"><span /></button>
          <button className="browser-chat-tool-copy-button" onClick={() => void copy()} type="button">
            {copied ? <Check size={14} /> : <Copy size={14} />}{t(copied ? '已复制' : '复制')}
          </button>
        </div>
        <BrowserChatCodeViewer payload={payload} wrap={wrap} />
      </div> : null}
    </details>
  );
}

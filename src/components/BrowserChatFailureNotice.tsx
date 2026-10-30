'use client';

import { memo } from 'react';
import { ChevronRight, CircleAlert } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { CopyTextButton } from '@/components/ui/copy-text-button';

export function isBrowserChatFailureNotice(text: string) {
  return /^(?:上游\s*AI\s*服务|AI\s*(?:请求|模型请求|服务|SDK)\s*)/u.test(text.trim())
    || /^(?:请求信息|技术细节|原始错误)[:：]/mu.test(text);
}

export const BrowserChatFailureNotice = memo(function BrowserChatFailureNotice({ text }: { text: string }) {
  const { t } = useI18n();
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const code = text.match(/\bcode=([A-Z][A-Z0-9_]+)/)?.[1];
  const state = lines.find(line => line.startsWith('本轮操作已停止'));
  const tlsInterrupted = /disconnected before secure TLS connection was established/i.test(text);
  const connectTimedOut = code === 'UND_ERR_CONNECT_TIMEOUT';
  const title = tlsInterrupted ? t('AI 连接未能建立')
    : connectTimedOut ? t('AI 连接超时')
      : t('本轮执行未完成');
  const description = tlsInterrupted ? t('安全连接建立前，连接已断开。')
    : connectTimedOut ? t('未能在规定时间内连接到 AI 服务。')
      : lines[0];

  return <section className="browser-chat-failure-notice" aria-label={title}>
    <div className="browser-chat-failure-heading">
      <span className="browser-chat-failure-symbol"><CircleAlert size={19} aria-hidden="true" /></span>
      <div className="browser-chat-failure-copy">
        <div className="browser-chat-failure-title"><strong>{title}</strong></div>
        <p>{description}</p>
        {state && state !== description ? <p className="browser-chat-failure-state">{state}</p> : null}
      </div>
    </div>
    <div className="browser-chat-failure-footer">
      <details className="browser-chat-failure-details">
        <summary><ChevronRight size={12} aria-hidden="true" /><span>{t('查看详情')}</span>{code ? <code>{code}</code> : null}</summary>
        <pre>{text}</pre>
      </details>
      <CopyTextButton text={text} label={t('复制完整错误信息')} className="browser-chat-failure-copy-button" size={14} />
    </div>
  </section>;
});

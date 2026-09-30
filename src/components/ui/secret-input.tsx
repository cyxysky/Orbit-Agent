'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, Copy, Eye, EyeOff, Loader2 } from 'lucide-react';
import { AppInput } from './app-input';
import { useI18n } from '@/i18n/I18nProvider';
import { maskSecret, type SettingsSecretSource } from '@/lib/secret-input';
import { withWebPilotBasePath } from '@/lib/webpilot-base-path';

export function SecretInput({ value, onChange, label, placeholder, storedPreview, source, headers, disabled }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  storedPreview?: string;
  source?: SettingsSecretSource;
  headers?: HeadersInit;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const [revealed, setRevealed] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [pendingAction, setPendingAction] = useState<'reveal' | 'copy' | null>(null);
  const busy = pendingAction !== null;
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  // A loaded secret is local display state, never a configuration edit.
  async function readSecret(signal: AbortSignal) {
    if (value) return value;
    if (revealed !== null) return revealed;
    if (!source || !storedPreview) return '';
    const requestHeaders = new Headers(headers);
    requestHeaders.set('Content-Type', 'application/json');
    const response = await fetch(withWebPilotBasePath('/api/settings/secret'), {
      method: 'POST', headers: requestHeaders, body: JSON.stringify(source), cache: 'no-store', signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || t('读取密钥失败'));
    return String(data.value || '');
  }
  async function act(action: 'reveal' | 'copy') {
    if (action === 'reveal' && revealed !== null) { setRevealed(null); return; }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPendingAction(action); setError('');
    try {
      const secret = await readSecret(controller.signal);
      if (controller.signal.aborted) return;
      if (action === 'copy') { await navigator.clipboard.writeText(secret); if (!controller.signal.aborted) setCopied(true); }
      else setRevealed(secret);
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : t('操作失败'));
    } finally { if (!controller.signal.aborted) setPendingAction(null); }
  }
  const available = Boolean(value || storedPreview);
  return <div className="settings-secret-control">
    <AppInput ref={input} aria-label={label} aria-describedby={error ? `${id}-error` : undefined}
      autoComplete="new-password" spellCheck={false} disabled={disabled}
      placeholder={storedPreview || placeholder}
      type={editing && revealed === null ? 'password' : 'text'}
      value={revealed !== null ? value || revealed : editing ? value : maskSecret(value)}
      onFocus={() => { setEditing(true); if (revealed === null && value) requestAnimationFrame(() => input.current?.select()); }}
      onBlur={() => setEditing(false)}
      onChange={event => {
        request.current?.abort(); setPendingAction(null); setError(''); setCopied(false);
        if (revealed !== null) setRevealed(event.target.value);
        onChange(event.target.value);
      }}
      suffix={<span className="settings-secret-actions">
        <button type="button" disabled={disabled || busy || !available} aria-label={t(revealed !== null ? '隐藏密钥' : '显示密钥')}
          aria-busy={pendingAction === 'reveal'}
          title={t(revealed !== null ? '隐藏密钥' : '显示密钥')} aria-pressed={revealed !== null} onClick={() => void act('reveal')}>
          {pendingAction === 'reveal' ? <Loader2 size={15} className="animate-spin" /> : revealed !== null ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
        <button type="button" disabled={disabled || busy || !available} aria-label={t(copied ? '已复制' : '复制密钥')}
          aria-busy={pendingAction === 'copy'}
          title={t(copied ? '已复制' : '复制密钥')} onClick={() => void act('copy')}>
          {pendingAction === 'copy' ? <Loader2 size={15} className="animate-spin" /> : copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
      </span>} />
    {error && <small className="settings-secret-error" id={`${id}-error`} role="alert">{error}</small>}
    <span className="sr-only" role="status">{copied ? t('已复制') : ''}</span>
  </div>;
}

'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { FloatingLayer } from '../FloatingLayer';
import { useI18n } from '@/i18n/I18nProvider';

export function ConfirmActionPopover({ children, label, title, description, className, disabled, onConfirm }: {
  children: ReactNode; label: string; title: string; description: string; className?: string; disabled?: boolean;
  onConfirm(): Promise<boolean | void>;
}) {
  const { t } = useI18n();
  const anchor = useRef<HTMLButtonElement>(null), id = useId();
  const [open, setOpen] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('');
  const close = () => { if (!pending) { setOpen(false); setError(''); anchor.current?.focus(); } };
  async function confirm() {
    if (pending) return;
    setPending(true); setError('');
    try { if (await onConfirm() !== false) { setOpen(false); anchor.current?.focus(); } else setError(t('删除失败，请重试。')); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPending(false); }
  }
  return <>
    <button ref={anchor} type="button" className={className} aria-label={label} title={label} disabled={disabled || pending}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { setOpen(value => !value); setError(''); }}>{children}</button>
    <FloatingLayer id={id} anchorRef={anchor} present={open} onDismiss={close} placement="right" align="start" preferredWidth={272}
      role="dialog" ariaLabel={title} className="confirm-action-popover">
      <strong>{title}</strong><p>{description}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="confirm-action-popover-actions">
        <button type="button" className="ui-button ui-button--neutral" disabled={pending} onClick={close}>{t('取消')}</button>
        <button type="button" className="ui-button is-danger" disabled={pending} onClick={() => void confirm()}>{pending && <Loader2 size={14} className="spin" />}{t('删除')}</button>
      </div>
    </FloatingLayer>
  </>;
}

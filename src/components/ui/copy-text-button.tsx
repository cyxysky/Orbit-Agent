'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, CircleAlert } from 'lucide-react';
import { IconAction } from '@/components/ui/icon-action';
import { useI18n } from '@/i18n/I18nProvider';

export function CopyTextButton({ text, label, className, disabled, size = 15 }: { text: string; label: string; className?: string; disabled?: boolean; size?: number }) {
  const { t } = useI18n();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = window.setTimeout(() => setState('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [state]);
  const title = state === 'copied' ? t('已复制') : state === 'failed' ? t('复制失败') : label;
  return <IconAction label={title} className={className} disabled={disabled} onClick={() => {
    void (async () => {
      try { await navigator.clipboard.writeText(text); setState('copied'); }
      catch { setState('failed'); }
    })();
  }}>{state === 'copied' ? <Check size={size} /> : state === 'failed' ? <CircleAlert size={size} /> : <Copy size={size} />}</IconAction>;
}

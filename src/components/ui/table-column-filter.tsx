'use client';

import { Filter, Search } from 'lucide-react';
import { useRef, useState } from 'react';
import { FloatingLayer } from '@/components/FloatingLayer';
import { useI18n } from '@/i18n/I18nProvider';

export function TableColumnFilter({ label, value, onApply }: { label: string; value: string; onApply: (value: string) => void }) {
  const { t } = useI18n();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  return <>
    <button aria-label={`${label} · ${t('筛选')}`} aria-haspopup="dialog" aria-expanded={open}
      className={`app-table-filter-trigger${value ? ' is-active' : ''}`} ref={anchor} type="button"
      onClick={event => { event.stopPropagation(); setDraft(value); setOpen(current => !current); }}
      onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <Filter aria-hidden="true" size={14} />
    </button>
    <FloatingLayer anchorRef={anchor} ariaLabel={`${label} · ${t('筛选')}`} className="app-table-filter-popover" present={open}
      align="start" placement="bottom" preferredWidth={260} role="dialog" onDismiss={() => setOpen(false)}>
      <form onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); onApply(draft.trim()); setOpen(false); }}>
        <header><strong>{label}</strong><span>{t('按内容筛选')}</span></header>
        <label className="app-table-filter-field"><span>{t('包含以下内容')}</span><div><Search aria-hidden="true" size={15} /><input autoFocus aria-label={`${label} · ${t('筛选内容')}`} onChange={event => setDraft(event.currentTarget.value)} placeholder={t('输入筛选内容')} type="text" value={draft} /></div></label>
        <footer><button className="ui-button ui-button--neutral" disabled={!value && !draft} onClick={() => { onApply(''); setOpen(false); }} type="button">{t('清除')}</button><button className="ui-button ui-button--primary" type="submit">{t('应用筛选')}</button></footer>
      </form>
    </FloatingLayer>
  </>;
}

'use client';

import { ListFilter, Search } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@heroui/react/button';
import { Form } from '@heroui/react/form';
import { InputGroup } from '@heroui/react/input-group';
import { Label } from '@heroui/react/label';
import { Popover } from '@heroui/react/popover';
import { TextField } from '@heroui/react/textfield';
import { useI18n } from '@/i18n/I18nProvider';

export function TableColumnFilter({ label, value, onApply }: { label: string; value: string; onApply: (value: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  return <span onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <Popover isOpen={open} onOpenChange={next => { if (next) setDraft(value); setOpen(next); }}>
      <Button aria-label={`${label} · ${t('筛选')}`} className="app-table-filter-trigger" data-filtered={Boolean(value) || undefined} isIconOnly size="sm" variant="ghost">
        <ListFilter aria-hidden="true" size={15} strokeWidth={1.75} />
      </Button>
      <Popover.Content className="app-table-filter-popover" placement="bottom start" offset={6} containerPadding={12}>
        <Popover.Dialog aria-label={`${label} · ${t('筛选')}`}>
          <Form onSubmit={event => { event.preventDefault(); onApply(draft.trim()); setOpen(false); }}>
            <Popover.Heading>{label}</Popover.Heading>
            <TextField value={draft} onChange={setDraft}>
              <Label>{t('包含以下内容')}</Label>
              <InputGroup><InputGroup.Prefix><Search aria-hidden="true" size={15} /></InputGroup.Prefix><InputGroup.Input autoFocus placeholder={t('输入筛选内容')} /></InputGroup>
            </TextField>
            <footer><Button isDisabled={!value && !draft} onPress={() => { onApply(''); setOpen(false); }} size="sm" variant="secondary">{t('清除')}</Button><Button size="sm" type="submit">{t('应用筛选')}</Button></footer>
          </Form>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  </span>;
}

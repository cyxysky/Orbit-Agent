'use client';

import { useId, useState } from 'react';
import { X } from 'lucide-react';
import { SettingsFields, useSettingsForms } from './SettingsFields';
import { AppModal } from '@/components/ui/app-modal';
import { useI18n } from '@/i18n/I18nProvider';
import type { ModelCapabilities } from '@/lib/model-capabilities';

export function ModelCapabilitiesModal({ model, capabilities, onClose, onSave }: {
  model: string;
  capabilities: ModelCapabilities;
  onClose: () => void;
  onSave: (capabilities: ModelCapabilities) => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const form = useSettingsForms()('model.capabilities');
  const [values, setValues] = useState<Record<string, string>>({ maxContextTokens: String(capabilities.maxContextTokens ?? ''), imageInput: String(capabilities.imageInput) });

  return (
    <AppModal ariaLabelledBy={titleId} dialogClassName="ui-modal ui-modal--form" onClose={onClose} size="sm">
      <form onSubmit={(event) => {
        event.preventDefault();
        const limit = values.maxContextTokens.trim() ? Number(values.maxContextTokens) : undefined;
        if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) return;
        onSave({ imageInput: values.imageInput === 'true', ...(limit !== undefined ? { maxContextTokens: limit } : {}) });
      }}>
        <header className="ui-modal-header">
          <div className="ui-modal-heading">
            <h2 className="ui-modal-title" id={titleId}>{t(form.title)}</h2>
            <p className="ui-modal-subtitle">{model}</p>
          </div>
          <button aria-label={t('关闭')} className="ui-icon-button ui-modal-close" onClick={onClose} type="button"><X size={16} /></button>
        </header>
        <div className="ui-modal-body model-capabilities-form">
          <SettingsFields bare form={form} values={values} onChange={(key, value) => setValues(current => ({ ...current, [key]: value }))} />
        </div>
        <footer className="ui-modal-footer">
          <button className="ui-button ui-button--neutral" onClick={onClose} type="button">{t('取消')}</button>
          <button className="ui-button ui-button--primary" type="submit">{t('保存')}</button>
        </footer>
      </form>
    </AppModal>
  );
}

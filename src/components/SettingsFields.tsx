'use client';

import type { ReactNode } from 'react';
import { FolderOpen, Plus, Trash2 } from 'lucide-react';
import type { SettingsField, SettingsForm } from '@/config/settings-schema';
import { settingsForms } from '@/config/settings-forms';
import { AppInput } from '@/components/ui/app-input';
import { SecretInput } from '@/components/ui/secret-input';
import type { SettingsSecretSource } from '@/lib/secret-input';
import { CustomSelect } from '@/components/CustomSelect';
import { SettingsDetailSection } from '@/components/SettingsDetailSection';
import { useI18n } from '@/i18n/I18nProvider';
import { useSettingsCatalog } from './useSettingsCatalog';
import { ThemeColorControl } from './ThemeColorControl';

export function useSettingsForms() {
  const { forms } = useSettingsCatalog();
  return (id: string) => forms.find(form => form.id === id) || settingsForms.find(form => form.id === id)!;
}

type FieldProps = {
  field: SettingsField;
  value: unknown;
  onChange: (value: string) => void;
  disabled?: boolean;
  secretPreview?: string;
  secretSource?: SettingsSecretSource;
  headers?: HeadersInit;
  onPickDirectory?: () => void;
  listDecoration?: (value: string, index: number) => ReactNode;
  listPrefix?: (value: string, index: number) => ReactNode;
  listActions?: { change: (index: number, value: string) => void; add: () => void; remove: (index: number) => void };
};

export function SettingsFieldControl({ field, value, onChange, disabled, secretPreview, secretSource, headers, onPickDirectory, listDecoration, listPrefix, listActions }: FieldProps) {
  const { t, language } = useI18n();
  const text = value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (field.control === 'boolean') return (
    <button aria-label={t(field.label)} role="switch" aria-checked={text === 'true'}
      className={`settings-toggle${text === 'true' ? ' on' : ''}`} disabled={disabled}
      onClick={() => onChange(String(text !== 'true'))} type="button"><span /></button>
  );
  if (field.control === 'select') return (
    <CustomSelect className="settings-control" disabled={disabled} value={text} onChange={onChange}
      options={(field.options || []).map(option => ({
        ...option,
        label: language === 'en' && option.label === '关闭' && option.value === 'false' ? 'Off' : t(option.label),
      }))} />
  );
  if (field.control === 'secret' || field.secret) return (
    <SecretInput key={`${JSON.stringify(secretSource)}:${secretPreview}`} label={t(field.label)}
      value={text} onChange={onChange} disabled={disabled} storedPreview={secretPreview}
      source={secretSource} headers={headers} placeholder={t(field.placeholder || '未设置')} />
  );
  if (field.control === 'pairs') {
    const pairs = Array.isArray(value) ? value as Array<{ key: string; value: string }> : [];
    const updatePair = (index: number, patch: Partial<{ key: string; value: string }>) => {
      onChange(JSON.stringify(pairs.map((entry, position) => position === index ? { ...entry, ...patch } : entry)));
    };
    return (
      <div className="settings-extra-parameters-control">
        {pairs.map((pair, index) => (
          <div className="settings-extra-parameter-input-row" key={index}>
            <AppInput aria-label={t('参数名')} disabled={disabled} value={pair.key} placeholder={t('参数名')}
              onChange={event => updatePair(index, { key: event.target.value })} />
            <AppInput aria-label={t('参数值')} disabled={disabled} value={pair.value} placeholder={t('参数值')}
              onChange={event => updatePair(index, { value: event.target.value })} />
            <button aria-label={t('删除参数')} className="settings-model-row-button danger" disabled={disabled}
              onClick={() => onChange(JSON.stringify(pairs.filter((_, position) => position !== index)))} type="button">
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        <button className="ui-button settings-add-parameter-button" disabled={disabled}
          onClick={() => onChange(JSON.stringify([...pairs, { key: '', value: '' }]))} type="button">
          <Plus size={15} />{t('添加参数')}
        </button>
      </div>
    );
  }
  if (field.control === 'list') {
    const items = Array.isArray(value) ? value.map(String) : [];
    return (
      <div className="settings-model-list-control">
        {items.map((item, index) => (
          <div className="settings-model-input-row" key={index}>
            <AppInput aria-label={t(field.label)} disabled={disabled} value={item}
              onChange={event => listActions ? listActions.change(index, event.target.value)
                : onChange(JSON.stringify(items.map((entry, position) => position === index ? event.target.value : entry)))}
              prefix={listPrefix?.(item, index)} suffix={listDecoration?.(item, index)} />
            <button className="settings-model-row-button danger" aria-label={t('删除')} disabled={disabled}
              onClick={() => listActions ? listActions.remove(index) : onChange(JSON.stringify(items.filter((_, position) => position !== index)))} type="button">
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        <button className="ui-button settings-add-model-button" disabled={disabled}
          onClick={() => listActions ? listActions.add() : onChange(JSON.stringify([...items, '']))} type="button">
          <Plus size={15} />{t('添加')}
        </button>
      </div>
    );
  }
  if (field.control === 'textarea' || field.control === 'json') return (
    <textarea aria-label={t(field.label)} className="settings-textarea-control" disabled={disabled}
      required={field.required} value={text} onChange={event => onChange(event.target.value)}
      maxLength={field.maxLength} placeholder={t(field.placeholder || '未设置')} rows={5} />
  );
  if (field.control === 'color') return (
    <ThemeColorControl disabled={disabled} value={text} onChange={onChange} defaultValue={field.defaultValue} label={field.label} />
  );
  const input = (
    <AppInput aria-label={t(field.label)} disabled={disabled} required={field.required} value={text}
      onChange={event => onChange(event.target.value)} type={field.control === 'number' ? 'number' : field.inputType || 'text'}
      min={field.min} max={field.max} step={field.step} maxLength={field.maxLength} placeholder={t(field.placeholder || '未设置')} />
  );
  if (field.picker) return (
    <div className="settings-directory-control">
      {input}
      {onPickDirectory ? <button className="ui-button ui-button--neutral" disabled={disabled} onClick={onPickDirectory} type="button">
        <FolderOpen size={15} />{t('选择')}
      </button> : null}
    </div>
  );
  return input;
}

export function SettingsFields({ form, values, onChange, fieldOptions, disabled, secretPreview, secretSource, headers, listDecoration, listPrefix, listActions, bare = false }: {
  form: SettingsForm;
  values: Record<string, unknown>;
  onChange: (key: string, value: string) => void;
  fieldOptions?: Record<string, Partial<SettingsField> & { disabled?: boolean; hidden?: boolean }>;
  disabled?: boolean;
  secretPreview?: string;
  secretSource?: SettingsSecretSource;
  headers?: HeadersInit;
  listDecoration?: FieldProps['listDecoration'];
  listPrefix?: FieldProps['listPrefix'];
  listActions?: FieldProps['listActions'];
  bare?: boolean;
}) {
  const { t } = useI18n();
  const rows = form.fields.filter(field => !fieldOptions?.[field.key]?.hidden && (!field.visibleWhen || String(values[field.visibleWhen.field]) === field.visibleWhen.value)).map(original => {
      const field = { ...original, ...fieldOptions?.[original.key] };
      return (
        <div className={`settings-row${field.control === 'textarea' || field.control === 'json' ? ' settings-prompt-row' : ''}`} data-setting-key={field.key} key={field.key}>
          <div><strong>{t(field.label)}</strong>{field.description ? <span>{t(field.description)}</span> : null}</div>
          <div className="settings-row-control">
            <SettingsFieldControl field={field} value={values[field.key]} onChange={value => onChange(field.key, value)}
              disabled={disabled || field.disabled} secretPreview={field.secret ? secretPreview : undefined}
              secretSource={field.secret ? secretSource : undefined} headers={headers}
              listDecoration={listDecoration} listPrefix={listPrefix} listActions={listActions} />
          </div>
        </div>
      );
    });
  return bare ? <>{rows}</> : <SettingsDetailSection heading={form.title ? t(form.title) : undefined} description={form.description ? t(form.description) : undefined}>{rows}</SettingsDetailSection>;
}

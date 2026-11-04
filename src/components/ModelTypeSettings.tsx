'use client';

import { SettingsDetailSection } from '@/components/SettingsDetailSection';

import type { ReactNode } from 'react';
import { SettingsFields, useSettingsForms } from './SettingsFields';
import { ModelBrandIcon } from '@/components/ModelBrandIcon';
import { useI18n } from '@/i18n/I18nProvider';
import type { ModelProvider } from '@/server/ai/schemas/runtime.schema';

export function ModelTypeSettings({ provider, enabled, models, defaultModel, onDefaultChange, onModelChange, onAdd, onRemove, modelSuffix, connection, children }: {
  provider: ModelProvider;
  enabled: boolean;
  models: string[];
  defaultModel: string;
  onDefaultChange: (model: string) => void;
  onModelChange: (index: number, value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  modelSuffix?: (model: string) => ReactNode;
  connection: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const availableModels = Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
  const form = useSettingsForms();
  return <>
    <SettingsFields form={form('model.default')} values={{ defaultModel }} disabled={!enabled}
      fieldOptions={{ defaultModel: { options: availableModels.map(model => ({ label: model, value: model })), disabled: !availableModels.length } }}
      onChange={(_, value) => onDefaultChange(value)} />
    <SettingsFields form={form('model.list')} values={{ models }} disabled={!enabled} onChange={() => undefined}
      listActions={{ change: onModelChange, add: onAdd, remove: onRemove }} listDecoration={modelSuffix}
      listPrefix={model => <span className="settings-model-icon"><ModelBrandIcon model={model} provider={provider} /></span>} />
    <SettingsDetailSection className="settings-model-group" heading={t(form('provider.connection').title)} description={t(form('provider.connection').description)}>
      {connection}
    </SettingsDetailSection>
    {children}
  </>;
}

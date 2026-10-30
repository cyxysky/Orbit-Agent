'use client';

import type { ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { AppInput } from '@/components/ui/app-input';
import { CustomSelect } from '@/components/CustomSelect';
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
  return <>
    <section className="settings-detail-panel settings-model-group">
      <div className="settings-row">
        <div><strong>{t('默认模型')}</strong><span>{t('选择当前类型默认使用的模型。')}</span></div>
        <CustomSelect className="settings-control" disabled={!enabled || !availableModels.length} value={defaultModel} onChange={onDefaultChange} options={availableModels.map((model) => ({ label: model, value: model }))} />
      </div>
    </section>
    <section className="settings-detail-panel settings-model-group">
      <header className="settings-detail-panel-head"><h3>{t('模型列表')}</h3><span>{t('管理该供应商在当前类型下可选择的模型。')}</span></header>
      <div className="settings-row settings-model-list-row">
        <div><span>{t('一个类型可以添加多个模型，运行时可在对话框中选择。')}</span></div>
        <div className="settings-model-list-control">
          {models.map((model, index) => <div className="settings-model-input-row" key={index}>
            <AppInput disabled={!enabled} prefix={<span className="settings-model-icon"><ModelBrandIcon model={model} provider={provider} /></span>} value={model} onChange={(event) => onModelChange(index, event.target.value)} placeholder={t('模型名称')} aria-label={t('模型名称')} suffix={modelSuffix?.(model)} />
            <button aria-label={t('删除模型')} className="settings-model-row-button danger" disabled={!enabled} onClick={() => onRemove(index)} title={t('删除模型')} type="button"><Trash2 size={15} /></button>
          </div>)}
          <button className="ui-button settings-add-model-button" disabled={!enabled} onClick={onAdd} type="button"><Plus size={15} />{t('添加模型')}</button>
        </div>
      </div>
    </section>
    <section className="settings-detail-panel settings-model-group">
      <header className="settings-detail-panel-head"><h3>{t('连接配置')}</h3><span>{t('服务地址、接口路径和请求参数仅用于当前类型。')}</span></header>
      {connection}
    </section>
    {children}
  </>;
}

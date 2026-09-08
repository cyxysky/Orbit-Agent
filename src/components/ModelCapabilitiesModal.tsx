'use client';

import { useId, useState } from 'react';
import { X } from 'lucide-react';
import { AppInput } from '@/components/ui/app-input';
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
  const contextId = useId();
  const [maxContextTokens, setMaxContextTokens] = useState(String(capabilities.maxContextTokens ?? ''));
  const [imageInput, setImageInput] = useState(capabilities.imageInput);

  return (
    <AppModal ariaLabelledBy={titleId} dialogClassName="ui-modal ui-modal--form" onClose={onClose} size="sm">
      <form onSubmit={(event) => {
        event.preventDefault();
        const limit = maxContextTokens.trim() ? Number(maxContextTokens) : undefined;
        if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) return;
        onSave({ imageInput, ...(limit !== undefined ? { maxContextTokens: limit } : {}) });
      }}>
        <header className="ui-modal-header">
          <div className="ui-modal-heading">
            <h2 className="ui-modal-title" id={titleId}>{t('编辑模型')}</h2>
            <p className="ui-modal-subtitle">{model}</p>
          </div>
          <button aria-label={t('关闭')} className="ui-icon-button ui-modal-close" onClick={onClose} type="button"><X size={16} /></button>
        </header>
        <div className="ui-modal-body model-capabilities-form">
          <label className="model-capabilities-field" htmlFor={contextId}>
            <strong>{t('该模型支持的最大上下文')}</strong>
            <AppInput id={contextId} type="number" min={1} max={Number.MAX_SAFE_INTEGER} step={1}
              value={maxContextTokens} onChange={(event) => setMaxContextTokens(event.target.value)}
              placeholder={t('留空使用默认上下文')} suffix={<span>Token</span>} />
            <small>{t('用于上下文用量显示和自动压缩预算。')}</small>
          </label>
          <div className="model-capabilities-switch">
            <strong>{t('该模型是否支持图片输入')}</strong>
            <button aria-label={t('该模型是否支持图片输入')} role="switch" aria-checked={imageInput}
              className={`settings-toggle${imageInput ? ' on' : ''}`} onClick={() => setImageInput(!imageInput)} type="button"><span /></button>
          </div>
        </div>
        <footer className="ui-modal-footer">
          <button className="ui-button ui-button--neutral" onClick={onClose} type="button">{t('取消')}</button>
          <button className="ui-button ui-button--primary" type="submit">{t('保存')}</button>
        </footer>
      </form>
    </AppModal>
  );
}

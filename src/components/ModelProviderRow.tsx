'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2 } from 'lucide-react';
import { ModelBrandIcon } from '@/components/ModelBrandIcon';
import { useI18n } from '@/i18n/I18nProvider';
import type { ModelProvider } from '@/server/ai/schemas/runtime.schema';

export function ModelProviderRow({ provider, model, active, enabled, label, onSelect, onDelete, deleteDisabled }: {
  provider: ModelProvider;
  model: string;
  active: boolean;
  enabled: boolean;
  label: string;
  onSelect: () => void;
  onDelete?: () => void;
  deleteDisabled?: boolean;
}) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: provider });
  const status = enabled ? t('已启用') : t('未启用');
  return (
    <div
      ref={setNodeRef}
      className={`settings-provider-row${active ? ' active' : ''}${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        {...attributes}
        {...listeners}
        ref={setActivatorNodeRef}
        aria-label={t('拖拽排序：{name}', { name: label })}
        className="settings-provider-drag-handle"
        title={t('拖拽排序')}
        type="button"
      >
        <GripVertical aria-hidden="true" size={14} />
      </button>
      <button
        aria-current={active ? 'true' : undefined}
        aria-label={`${label}，${status}`}
        className="settings-provider-select"
        data-provider={provider}
        onClick={onSelect}
        title={label}
        type="button"
      >
        <span aria-hidden="true" className="settings-provider-icon"><ModelBrandIcon model={model} provider={provider} /></span>
        <span className="settings-provider-copy"><strong>{label}</strong><small>{status}</small></span>
        <span aria-hidden="true" className={`settings-provider-status${enabled ? ' is-enabled' : ''}`} />
      </button>
      {onDelete ? (
        <button
          aria-label={t('删除供应商：{name}', { name: label })}
          className="settings-provider-delete"
          disabled={deleteDisabled}
          onClick={onDelete}
          title={t('删除自定义供应商')}
          type="button"
        ><Trash2 aria-hidden="true" size={14} /></button>
      ) : null}
    </div>
  );
}

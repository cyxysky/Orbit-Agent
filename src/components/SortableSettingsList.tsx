'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { subscribeSettingsPreferences, updateSettingsPreference } from '@/lib/settings-preferences';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './SortableSettingsList.module.css';

type Orders = Record<string, string[]>;
function readOrders(raw: string | undefined): Orders {
  try {
    const value = JSON.parse(raw || '{}');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter(([, ids]) => Array.isArray(ids))
        .map(([group, ids]) => [group, [...new Set((ids as unknown[]).filter((id): id is string => typeof id === 'string'))]])) : {};
  } catch { return {}; }
}

function SortableRow({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  return <div ref={setNodeRef} className={styles.row} data-dragging={isDragging || undefined}
    style={{ transform: CSS.Transform.toString(transform), transition }} role="listitem">
    <button type="button" ref={setActivatorNodeRef} className={styles.handle} {...attributes} {...listeners}
      aria-label={t('拖拽排序：{name}', { name: label })} title={t('拖拽排序')}><GripVertical size={16} /></button>
    <div className={styles.content}>{children}</div>
  </div>;
}

export function SortableSettingsList<T>({ group, items, itemId, itemLabel, renderItem, className }: {
  group: string; items: readonly T[]; itemId: (item: T) => string; itemLabel: (item: T) => string;
  renderItem: (item: T) => ReactNode; className?: string;
}) {
  const [orders, setOrders] = useState<Orders>({});
  const currentOrders = useRef(orders);
  useEffect(() => subscribeSettingsPreferences(values => {
    const next = readOrders(values.UI_TOOL_ORDER); currentOrders.current = next; setOrders(next);
  }), []);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ranks = new Map((orders[group] || []).map((id, index) => [id, index]));
  const sorted = [...items].sort((a, b) => (ranks.get(itemId(a)) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(itemId(b)) ?? Number.MAX_SAFE_INTEGER));
  const ids = sorted.map(itemId);
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id)), to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    updateSettingsPreference('UI_TOOL_ORDER', JSON.stringify({ ...currentOrders.current, [group]: arrayMove(ids, from, to) }));
  }}><SortableContext items={ids} strategy={verticalListSortingStrategy}>
    <div className={className} role="list">{sorted.map(item => <SortableRow id={itemId(item)} label={itemLabel(item)} key={itemId(item)}>{renderItem(item)}</SortableRow>)}</div>
  </SortableContext></DndContext>;
}

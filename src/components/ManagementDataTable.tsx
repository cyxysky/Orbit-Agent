'use client';

import { InputGroup } from '@heroui/react/input-group';
import { useDeferredValue, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Search, Trash2, X } from 'lucide-react';
import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { useI18n } from '@/i18n/I18nProvider';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';

type ManagementDataTableFilterType = 'datetime' | 'number' | 'select' | 'text';

type ManagementDataTableFilterOption = {
  label: string;
  value: string;
};

type ManagementDataTableFilter<T> = {
  getValue: (item: T) => number | string | Array<number | string> | null | undefined;
  options?: ManagementDataTableFilterOption[];
  type: ManagementDataTableFilterType;
};

export type ManagementDataTableColumn<T> = {
  className?: string;
  filter?: ManagementDataTableFilter<T>;
  key: string;
  label: string;
  render: (item: T) => ReactNode;
};

export function ManagementDataTable<T>({
  columns,
  emptyText,
  getId,
  getSearchText,
  items,
  renderExpandedRow,
  rowClassName,
  searchPlaceholder,
  toolbarActions,
  canDeleteItem,
  onDeleteItem,
}: {
  columns: ManagementDataTableColumn<T>[];
  emptyText: string;
  getId: (item: T) => string;
  getSearchText: (item: T) => string[];
  items: T[];
  renderExpandedRow?: (item: T) => ReactNode;
  rowClassName?: (item: T) => string;
  searchPlaceholder: string;
  toolbarActions?: ReactNode;
  canDeleteItem?: (item: T) => boolean;
  onDeleteItem?: (item: T) => Promise<void>;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteTargets, setDeleteTargets] = useState<T[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const deleteBusyRef = useRef(false);
  const deleteDialogId = useId();
  const deferredQuery = useDeferredValue(query);
  const filteredItems = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLocaleLowerCase();
    if (!normalizedQuery) return items;
    return items.filter((item) => getSearchText(item)
        .join('\n')
        .toLocaleLowerCase()
        .includes(normalizedQuery));
  }, [deferredQuery, getSearchText, items]);
  const hasActiveFilters = Boolean(query.trim());
  const selectableItems = filteredItems.filter(item => !canDeleteItem || canDeleteItem(item));
  const selectedItems = selectableItems.filter(item => selectedIds.has(getId(item)));
  const allSelected = selectableItems.length > 0 && selectedItems.length === selectableItems.length;
  const toggleSelection = (ids: string[], checked: boolean) => setSelectedIds(current => {
    const next = new Set(current);
    for (const id of ids) { if (checked) next.add(id); else next.delete(id); }
    return next;
  });
  async function deleteSelected() {
    if (!deleteTargets || !onDeleteItem || deleteBusyRef.current) return;
    deleteBusyRef.current = true;
    setDeleting(true);
    setDeleteError('');
    const failed: T[] = [];
    const errors: string[] = [];
    try {
      for (const target of deleteTargets) {
        const id = getId(target);
        const current = items.find(item => getId(item) === id);
        if (!current) { toggleSelection([id], false); continue; }
        try {
          if (canDeleteItem && !canDeleteItem(current)) throw new Error(t('只读'));
          await onDeleteItem(current);
          toggleSelection([id], false);
        } catch (error) {
          failed.push(current);
          errors.push(`${getSearchText(current)[0] || id}：${error instanceof Error ? error.message : t('删除失败')}`);
        }
      }
      setDeleteTargets(failed.length ? failed : null);
      if (failed.length) setDeleteError(t('有 {count} 条删除失败，可重试；成功删除的条目不会重复提交。', { count: failed.length }) + '\n' + errors.slice(0, 3).join('\n'));
    } finally {
      deleteBusyRef.current = false;
      setDeleting(false);
    }
  }

  return (
    <div className="management-data-table">
      <div className="domain-list-toolbar management-data-table-toolbar">
        <div className="domain-list-search">
          <InputGroup fullWidth>
            <InputGroup.Prefix><Search size={15} /></InputGroup.Prefix>
            <InputGroup.Input
            aria-label={searchPlaceholder}
            onChange={(event) => { setQuery(event.target.value); setSelectedIds(new Set()); }}
            placeholder={searchPlaceholder}
            type="search"
            value={query}
            />
            {query ? (
              <InputGroup.Suffix>
                <button aria-label={t('清空筛选')} onClick={() => { setQuery(''); setSelectedIds(new Set()); }} type="button"><X size={14} /></button>
              </InputGroup.Suffix>
            ) : null}
          </InputGroup>
        </div>
        <div className="domain-list-toolbar-meta">
          <span className="domain-list-count">{t('显示 {visible} / {total} 条', { visible: filteredItems.length, total: items.length })}</span>
          {onDeleteItem ? <>
            {selectedItems.length > 0 ? <button className="ui-button ui-button--ghost" disabled={deleting} onClick={() => setSelectedIds(new Set())} type="button">{t('取消选择')}</button> : null}
            <button className="ui-button ui-button--danger" disabled={!selectedItems.length || deleting}
              onClick={() => { setDeleteTargets([...selectedItems]); setDeleteError(''); }} type="button">
              <Trash2 size={15} />{t('批量删除')} ({selectedItems.length})
            </button>
          </> : null}
          {toolbarActions}
        </div>
      </div>

      <DataTable
        className="management-data-table-grid"
        columns={[
          ...(onDeleteItem ? [{
            id: '__selection', className: 'management-table-selection-column', sortable: false,
            header: <input type="checkbox" aria-label={t('全选当前筛选结果（仅可删除项）')} checked={allSelected}
              ref={element => { if (element) element.indeterminate = selectedItems.length > 0 && !allSelected; }}
              disabled={deleting || !selectableItems.length} onChange={event => toggleSelection(selectableItems.map(getId), event.target.checked)} />,
            cell: (item: T) => <input type="checkbox" aria-label={t('选择 {name}', { name: getSearchText(item)[0] || getId(item) })}
              checked={selectedIds.has(getId(item)) && (!canDeleteItem || canDeleteItem(item))}
              disabled={deleting || Boolean(canDeleteItem && !canDeleteItem(item))}
              onChange={event => toggleSelection([getId(item)], event.target.checked)} />,
          }] : []),
          ...columns.map((column): DataTableColumn<T> => ({
          accessor: column.filter ? (item) => {
            const value = column.filter?.getValue(item);
            return Array.isArray(value) ? value.join(' ') : value ?? '';
          } : undefined,
          cell: column.render,
          className: column.className,
          header: column.label,
          id: column.key,
          sortable: Boolean(column.filter),
        }))]}
        data={filteredItems}
        emptyText={hasActiveFilters ? t('没有符合筛选条件的数据') : emptyText}
        getRowId={getId}
        minWidth={900}
        renderExpandedRow={renderExpandedRow}
        rowClassName={rowClassName}
      />
      {deleteTargets ? <ConfirmDeleteModal id={deleteDialogId} deleting={deleting} error={deleteError}
        title={t('批量删除')} itemTitle={t('已选择 {count} 条', { count: deleteTargets.length })}
        description={t('确定删除以下条目吗？') + '\n' + deleteTargets.slice(0, 5).map(item => getSearchText(item)[0] || getId(item)).join('、') + (deleteTargets.length > 5 ? '…' : '')}
        onClose={() => { if (!deleteBusyRef.current) setDeleteTargets(null); }} onConfirm={deleteSelected} /> : null}
    </div>
  );
}

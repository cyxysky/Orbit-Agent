'use client';

import { EmptyState } from '@heroui/react/empty-state';
import { Table } from '@heroui/react/table';
import { ChevronLeft, ChevronRight, Layers, X } from 'lucide-react';
import { TableColumnFilter } from '@/components/ui/table-column-filter';
import type { SortDescriptor } from 'react-aria-components';
import { useDeferredValue, useMemo, useState, type ReactNode } from 'react';
import { useI18n } from '@/i18n/I18nProvider';

export type DataTableColumn<T> = {
  accessor?: (item: T) => number | string | null | undefined;
  filterAccessor?: (item: T) => number | string | null | undefined;
  cell: (item: T) => ReactNode;
  className?: string;
  header: ReactNode;
  id: string;
  sortable?: boolean;
};

type RenderRow<T> = {
  content?: ReactNode;
  id: string;
  item: T;
  kind: 'data' | 'expanded';
};

const tableValueCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

function compareValues(
  left: number | string | null | undefined,
  right: number | string | null | undefined,
) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return tableValueCollator.compare(String(left), String(right));
}

export function DataTable<T>({
  className,
  columns,
  compact = false,
  data,
  emptyDescription,
  emptyAction,
  emptyText,
  getRowId,
  minWidth,
  pagination = false,
  filterable = false,
  renderExpandedRow,
  rowClassName,
}: {
  className?: string;
  columns: DataTableColumn<T>[];
  compact?: boolean;
  data: T[];
  emptyDescription?: string;
  emptyAction?: ReactNode;
  emptyText: string;
  getRowId: (item: T) => string;
  minWidth?: number;
  pagination?: boolean;
  filterable?: boolean;
  renderExpandedRow?: (item: T) => ReactNode;
  rowClassName?: (item: T) => string | undefined;
}) {
  const { t } = useI18n();
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const deferredFilters = useDeferredValue(filters);
  const activeFilters = filterable ? columns.filter(column => filters[column.id]?.trim()) : [];
  const filteredData = useMemo(() => {
    if (!filterable) return data;
    const active = columns.filter(column => column.accessor && deferredFilters[column.id]?.trim());
    return active.length ? data.filter(item => active.every(column => String((column.filterAccessor || column.accessor)!(item) ?? '')
      .toLocaleLowerCase().includes(deferredFilters[column.id].trim().toLocaleLowerCase()))) : data;
  }, [columns, data, deferredFilters, filterable]);
  const deferredSortDescriptor = useDeferredValue(sortDescriptor);
  const sortedData = useMemo(() => {
    if (!deferredSortDescriptor) return filteredData;
    const column = columns.find((candidate) => candidate.id === String(deferredSortDescriptor.column));
    if (!column?.accessor || column.sortable === false) return filteredData;
    const accessor = column.accessor;
    const multiplier = deferredSortDescriptor.direction === 'descending' ? -1 : 1;
    return filteredData
      .map((item, index) => ({ index, item, value: accessor(item) }))
      .sort((left, right) => (
        multiplier * compareValues(left.value, right.value) || left.index - right.index
      ))
      .map(({ item }) => item);
  }, [columns, filteredData, deferredSortDescriptor]);
  const pageCount = Math.max(1, Math.ceil(sortedData.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleData = useMemo(() => pagination
    ? sortedData.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    : sortedData, [currentPage, pageSize, pagination, sortedData]);
  const rows = useMemo<RenderRow<T>[]>(() => visibleData.flatMap((item) => {
    const id = getRowId(item);
    const content = renderExpandedRow?.(item);
    return content
      ? [
        { id, item, kind: 'data' as const },
        { content, id: `${id}:expanded`, item, kind: 'expanded' as const },
      ]
      : [{ id, item, kind: 'data' as const }];
  }), [getRowId, renderExpandedRow, visibleData]);

  if (data.length === 0) {
    return <EmptyState className="management-table-empty-state">
      <div className="management-table-empty-icon" aria-hidden="true"><Layers size={25} strokeWidth={1.25} /></div>
      <div className="management-table-empty-copy" role="status">
        <p className="management-table-empty-title">{emptyText}</p>
        {emptyDescription ? <p className="management-table-empty-description">{emptyDescription}</p> : null}
      </div>
      {emptyAction ? <div className="management-table-empty-action">{emptyAction}</div> : null}
    </EmptyState>;
  }

  return (
    <div className="app-data-table-region">
    {activeFilters.length ? <div className="app-data-table-active-filters" aria-label={t('筛选条件')}>
      {activeFilters.map(column => <button className="app-data-table-filter-chip" key={column.id} onClick={() => { setFilters(current => ({ ...current, [column.id]: '' })); setPage(1); }} type="button" aria-label={`${t('清除')} ${typeof column.header === 'string' ? column.header : column.id} · ${filters[column.id]}`}>
        <span>{column.header}: {filters[column.id]}</span><X aria-hidden="true" size={12} />
      </button>)}
      <button className="app-data-table-clear-filters" onClick={() => { setFilters({}); setPage(1); }} type="button">{t('清除全部')}</button>
    </div> : null}
    <Table variant="primary" className={['app-data-table', compact ? 'is-compact' : '', className || ''].filter(Boolean).join(' ')}>
      <Table.ScrollContainer>
        <Table.Content
          aria-label={t('数据表')}
          onSortChange={next => { setSortDescriptor(next); setPage(1); }}
          sortDescriptor={sortDescriptor}
          style={minWidth ? { minWidth } : undefined}
        >
          <Table.Header>
            {columns.map((column, index) => (
              <Table.Column
                allowsSorting={column.sortable !== false && Boolean(column.accessor)}
                className={column.className}
                id={column.id}
                isRowHeader={index === (columns[0]?.id === '__selection' ? 1 : 0)}
                key={column.id}
              >
                {({ sortDirection }) => <div className="app-data-table-heading">
                {column.sortable !== false && column.accessor ? (
                  <Table.SortableColumnHeader sortDirection={sortDirection}>
                    <span className="app-data-table-header-label">{column.header}</span>
                  </Table.SortableColumnHeader>
                ) : <span className="app-data-table-header-label">{column.header}</span>}
                {filterable && column.accessor ? <TableColumnFilter
                  label={typeof column.header === 'string' ? column.header : column.id}
                  onApply={value => { setFilters(current => ({ ...current, [column.id]: value })); setPage(1); }}
                  value={filters[column.id] || ''}
                /> : null}
                </div>}
              </Table.Column>
            ))}
          </Table.Header>
          <Table.Body items={rows} dependencies={[columns, rowClassName]} renderEmptyState={() => t('没有符合条件的记录')}>
            {(row) => row.kind === 'expanded' ? (
              <Table.Row id={row.id}>
                <Table.Cell colSpan={columns.length}>{row.content}</Table.Cell>
              </Table.Row>
            ) : (
              <Table.Row className={rowClassName?.(row.item)} id={row.id}>
                {columns.map((column) => (
                  <Table.Cell className={column.className} key={column.id}>{column.cell(row.item)}</Table.Cell>
                ))}
              </Table.Row>
            )}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
    {pagination ? <nav className="app-data-table-pagination" aria-label={t('表格分页')}>
      <span role="status">{t('共 {count} 条', { count: sortedData.length })}</span>
      <label>{t('每页')} <select aria-label={t('每页条数')} value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}>
        {[10, 20, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}
      </select></label>
      <div className="app-data-table-page-controls">
        <button aria-label={t('上一页')} disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} type="button"><ChevronLeft size={16} /></button>
        <label>{t('第')} <input aria-label={t('页码')} type="number" min={1} max={pageCount} value={currentPage} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) setPage(Math.max(1, Math.min(pageCount, Math.trunc(value)))); }} /> / {pageCount}</label>
        <button aria-label={t('下一页')} disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)} type="button"><ChevronRight size={16} /></button>
      </div>
    </nav> : null}
    </div>
  );
}

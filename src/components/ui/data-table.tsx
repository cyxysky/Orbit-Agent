'use client';

import { EmptyState } from '@heroui/react/empty-state';
import { Button } from '@heroui/react/button';
import { Chip } from '@heroui/react/chip';
import { CloseButton } from '@heroui/react/close-button';
import { ListBox } from '@heroui/react/list-box';
import { ListBoxItem } from '@heroui/react/list-box-item';
import { NumberField } from '@heroui/react/number-field';
import { Pagination } from '@heroui/react/pagination';
import { Select } from '@heroui/react/select';
import { Table } from '@heroui/react/table';
import { Layers } from 'lucide-react';
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
      {activeFilters.map(column => <Chip className="app-data-table-filter-chip" color="accent" key={column.id} size="sm" variant="soft">
        <Chip.Label>{column.header}: {filters[column.id]}</Chip.Label>
        <CloseButton aria-label={`${t('清除')} ${typeof column.header === 'string' ? column.header : column.id} · ${filters[column.id]}`} onPress={() => { setFilters(current => ({ ...current, [column.id]: '' })); setPage(1); }} />
      </Chip>)}
      <Button className="app-data-table-clear-filters" onPress={() => { setFilters({}); setPage(1); }} size="sm" variant="ghost">{t('清除全部')}</Button>
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
    {pagination ? <Pagination className="app-data-table-pagination" size="sm" aria-label={t('表格分页')}>
      <Pagination.Summary role="status">{t('共 {count} 条', { count: sortedData.length })}</Pagination.Summary>
      <div className="app-data-table-page-controls">
        <span>{t('每页')}</span>
        <Select className="app-data-table-page-size" aria-label={t('每页条数')} value={String(pageSize)} onChange={value => { if (value !== null) { setPageSize(Number(value)); setPage(1); } }}>
          <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
          <Select.Popover placement="top end"><ListBox>
            {[10, 20, 50, 100].map(size => <ListBoxItem id={String(size)} key={size} textValue={String(size)}>{size}<ListBoxItem.Indicator /></ListBoxItem>)}
          </ListBox></Select.Popover>
        </Select>
        <Pagination.Content>
          <Pagination.Item><Pagination.Previous aria-label={t('上一页')} isDisabled={currentPage <= 1} onPress={() => setPage(currentPage - 1)}><Pagination.PreviousIcon /></Pagination.Previous></Pagination.Item>
          <Pagination.Item className="app-data-table-page-jump">
            <span>{t('第')}</span>
            <NumberField className="app-data-table-page-number" aria-label={t('页码')} minValue={1} maxValue={pageCount} value={currentPage} formatOptions={{ useGrouping: false }} onChange={value => { if (Number.isFinite(value)) setPage(Math.max(1, Math.min(pageCount, Math.trunc(value)))); }}>
              <NumberField.Group><NumberField.Input /></NumberField.Group>
            </NumberField>
            <span>/ {pageCount}</span>
          </Pagination.Item>
          <Pagination.Item><Pagination.Next aria-label={t('下一页')} isDisabled={currentPage >= pageCount} onPress={() => setPage(currentPage + 1)}><Pagination.NextIcon /></Pagination.Next></Pagination.Item>
        </Pagination.Content>
      </div>
    </Pagination> : null}
    </div>
  );
}

'use client';

import { Chip } from '@heroui/react/chip';
import Link from 'next/link';
import type { ReactNode } from 'react';
import styles from './data-table-cells.module.css';

export function DataTableText({ primary, secondary, href }: { primary: ReactNode; secondary?: string; href?: string }) {
  return <div className={styles.copy}>
    {href ? <Link className={styles.primary} href={href}>{primary}</Link> : <strong className={styles.primary}>{primary}</strong>}
    {secondary ? <small className={styles.secondary} title={secondary}>{secondary}</small> : null}
  </div>;
}

export function DataTableStatus({ status, children }: { status: string; children: ReactNode }) {
  const color = ['failed', 'interrupted', 'error'].includes(status) ? 'danger'
    : ['blocked', 'initializing', 'queued'].includes(status) ? 'warning'
      : ['passed', 'completed', 'ready'].includes(status) ? 'success'
        : ['running', 'busy'].includes(status) ? 'accent' : 'default';
  return <Chip color={color} size="sm" variant="soft"><Chip.Label>{children}</Chip.Label></Chip>;
}

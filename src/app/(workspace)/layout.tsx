import type { ReactNode } from 'react';
import { WorkspaceApplicationLayout } from '@/components/WorkspaceApplicationLayout';

export const dynamic = 'force-dynamic';

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <WorkspaceApplicationLayout>{children}</WorkspaceApplicationLayout>;
}

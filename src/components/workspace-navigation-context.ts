'use client';

import { createContext, useContext } from 'react';

export type WorkspacePath = '/browser-chat' | '/automation' | '/admin/ai-operations' | '/settings';

export const WorkspaceNavigationContext = createContext<{
  pendingPath: WorkspacePath | null;
  startNavigation?: (path: WorkspacePath) => void;
}>({ pendingPath: null });

export function useWorkspaceNavigation() {
  return useContext(WorkspaceNavigationContext);
}

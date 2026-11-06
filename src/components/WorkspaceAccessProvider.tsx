'use client';

import { createContext, useContext, type ReactNode } from 'react';

type WorkspaceAccess = { settingsMenuVisible: boolean; initialSidebarCollapsed: boolean; showAiOperations: boolean };
const WorkspaceAccessContext = createContext<WorkspaceAccess>({ settingsMenuVisible: false, initialSidebarCollapsed: false, showAiOperations: false });

export function WorkspaceAccessProvider({ children, settingsMenuVisible, initialSidebarCollapsed = false, showAiOperations = false }: Pick<WorkspaceAccess, 'settingsMenuVisible'> & Partial<WorkspaceAccess> & { children: ReactNode }) {
  return <WorkspaceAccessContext.Provider value={{ settingsMenuVisible, initialSidebarCollapsed, showAiOperations }}>{children}</WorkspaceAccessContext.Provider>;
}

export function useWorkspaceAccess() {
  return useContext(WorkspaceAccessContext);
}

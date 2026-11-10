'use client';

import { createContext, useContext, type ReactNode } from 'react';

type WorkspaceAccess = { settingsMenuVisible: boolean; initialSidebarCollapsed: boolean; showAiOperations: boolean; administratorAuthenticated: boolean; administratorExpiresAt?: number };
const WorkspaceAccessContext = createContext<WorkspaceAccess>({ settingsMenuVisible: false, initialSidebarCollapsed: false, showAiOperations: false, administratorAuthenticated: false });

export function WorkspaceAccessProvider({ children, settingsMenuVisible, initialSidebarCollapsed = false, showAiOperations = false, administratorAuthenticated = false, administratorExpiresAt }: Pick<WorkspaceAccess, 'settingsMenuVisible'> & Partial<WorkspaceAccess> & { children: ReactNode }) {
  return <WorkspaceAccessContext.Provider value={{ settingsMenuVisible, initialSidebarCollapsed, showAiOperations, administratorAuthenticated, administratorExpiresAt }}>{children}</WorkspaceAccessContext.Provider>;
}

export function useWorkspaceAccess() {
  return useContext(WorkspaceAccessContext);
}

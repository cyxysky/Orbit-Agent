'use client';

import { createContext, useContext, type ReactNode } from 'react';

type WorkspaceAccess = { settingsMenuVisible: boolean };
const WorkspaceAccessContext = createContext<WorkspaceAccess>({ settingsMenuVisible: false });

export function WorkspaceAccessProvider({ children, settingsMenuVisible }: WorkspaceAccess & { children: ReactNode }) {
  return <WorkspaceAccessContext.Provider value={{ settingsMenuVisible }}>{children}</WorkspaceAccessContext.Provider>;
}

export function useWorkspaceAccess() {
  return useContext(WorkspaceAccessContext);
}

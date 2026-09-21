export type TaskContextEntry = {
  key: string; text: string; source: string; updatedAt: string;
  taskId: string; scopeId: string; kind: 'note' | 'user_requirement'; verified: false;
};
export type TaskContextState = {
  taskId: string; revision: number; status: 'active' | 'cancelled';
  currentRequestRef: string; requestRefs: string[];
};
export type TaskContextPage = { state: TaskContextState; entries: TaskContextEntry[]; nextCursor?: string };

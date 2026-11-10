export type ManagedToolInstallStep = { id: string; label: string; status: 'pending' | 'running' | 'completed' | 'failed'; startedAt?: string; finishedAt?: string };
export type ManagedToolInstallProgress = { startedAt: string; currentStep?: string; steps: ManagedToolInstallStep[] };
export function createInstallProgress(tool: { runtime?: string }, at?: string): ManagedToolInstallProgress;
export function advanceInstallProgress(progress: ManagedToolInstallProgress, phase: string, at?: string): ManagedToolInstallProgress;

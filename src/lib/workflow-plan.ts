export type WorkflowStatus = 'pending' | 'running' | 'passed' | 'failed' | 'blocked' | 'not_applicable';
export type WorkflowCheck = { id: string; label: string; evidenceRequired: boolean; status: WorkflowStatus; result: string; evidence: Array<{ toolCallId: string; description: string; sourceSummary?: string; screenshots?: Array<{ url: string; title: string }> }> };
export type WorkflowItem = { id: string; title: string; source: string; dependsOn: string[]; checks: WorkflowCheck[] };
export type WorkflowStage = { id: string; title: string; confirmationRequired: boolean; items: WorkflowItem[] };
export type WorkflowPlan = {
  sessionId: string; title: string; revision: number; stageIndex: number;
  status: 'active' | 'awaiting_review' | 'completed' | 'cancelled';
  stages: WorkflowStage[]; currentItemId?: string;
  submissions: Array<{ id: string; revision: number; stageId: string; summary: string; gaps: string[]; items: WorkflowItem[]; decision?: string; feedback?: string; reviewedBy?: string }>;
  feedback?: string; updatedAt: string;
};

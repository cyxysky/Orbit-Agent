import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { queryDatabase, queryDatabaseOne, executeDatabase, runDatabaseTransaction } from '@/server/db/database';
import type { DatabaseExecutor } from '@/server/db/database';
import type { WorkflowPlan, WorkflowItem, WorkflowCheck } from '@/lib/workflow-plan';

const id = z.string().min(1).max(120);
const checkSchema = z.object({ id, label: z.string().min(1).max(300), evidenceRequired: z.boolean() });
const itemSchema = z.object({ id, title: z.string().min(1).max(500), source: z.string().min(1).max(2000), dependsOn: z.array(id).max(500), checks: z.array(checkSchema).min(1).max(30) });
export const workflowInputSchema = z.object({
  action: z.enum(['register', 'read', 'appendItems', 'beginItem', 'recordCheck', 'submitStage']),
  expectedRevision: z.number().int().nonnegative().optional().describe('REQUIRED for every action except read. Copy revision from the latest successful workflow result; register starts at 0.'),
  reason: z.string().max(300).optional(),
  query: z.string().max(300).optional().describe('For read: filter persisted evidence by tool ID, operation reason or result text.'),
  title: z.string().min(1).max(300).optional(),
  stages: z.array(z.object({ id, title: z.string().min(1).max(300), confirmationRequired: z.boolean(), items: z.array(itemSchema).min(1).max(1000) })).min(1).max(20).optional(),
  itemId: id.optional(), checkId: id.optional(),
  stageId: id.optional(), items: z.array(itemSchema).min(1).max(1000).optional(),
  status: z.enum(['pending', 'running', 'passed', 'failed', 'blocked', 'not_applicable']).optional(),
  result: z.string().max(8000).optional(),
  evidence: z.array(z.object({ toolCallId: id, description: z.string().min(1).max(2000) })).max(50).optional(),
  summary: z.string().max(16000).optional(),
}).strict().superRefine((input, ctx) => {
  const required: Record<string, string[]> = { read: [], register: ['expectedRevision', 'title', 'stages'], appendItems: ['expectedRevision', 'stageId', 'items'], beginItem: ['expectedRevision', 'itemId'], recordCheck: ['expectedRevision', 'itemId', 'checkId', 'status', 'result'], submitStage: ['expectedRevision', 'summary'] };
  for (const key of required[input.action]) if (input[key as keyof typeof input] === undefined) ctx.addIssue({ code: 'custom', path: [key], message: `${input.action} requires ${key}. Use read to obtain current revision, item/check IDs and real evidence IDs.` });
});

export const workflowPrompt = `Maintain an optional plan for the user's task. Stages, items, checks, dependencies, evidence requirements and review boundaries come from that task; do not invent a standard business process. read returns current state and available evidence IDs. register defines the plan; appendItems adds scope; beginItem changes the current focus without completing other items; recordCheck records an item's actual outcome. Independent items can be in progress together. Use dependsOn only for actual prerequisites. status describes the registered check, not success of a tool invocation. Include evidence only for claims it supports. For mutations, copy expectedRevision from the latest result. submitStage saves a reviewable snapshot: with confirmationRequired it awaits user review, otherwise it advances only when all checks are terminal. An incomplete snapshot remains active without claiming completion. Only the user can approve a submitted review. A reply (including finalResponse) does not complete, cancel, or advance the plan. Report progress and remaining work accurately, and follow the user's requested stopping and confirmation boundaries. Use taskContext for durable task notes independently of this plan.`;

export async function readWorkflow(sessionId: string, executor?: DatabaseExecutor): Promise<WorkflowPlan | undefined> {
  const row = await queryDatabaseOne<{ record_json: string }>('SELECT record_json FROM workflow_plan WHERE session_id = ?', [sessionId], executor);
  return row ? JSON.parse(row.record_json) : undefined;
}

function allItems(plan: WorkflowPlan) { return plan.stages.flatMap(s => s.items); }
function unfinished(item: WorkflowItem) { return item.checks.some(c => c.status === 'pending' || c.status === 'running'); }
function ready(plan: WorkflowPlan, item: WorkflowItem) {
  return item.dependsOn.every(id => allItems(plan).find(i => i.id === id)?.checks.every(c => c.status === 'passed' || c.status === 'not_applicable'));
}
async function commit(plan: WorkflowPlan, previous: number, event: unknown, executor: DatabaseExecutor) {
  plan.revision = previous + 1; plan.updatedAt = new Date().toISOString();
  if (!previous) await executeDatabase('INSERT INTO workflow_plan (session_id, revision, record_json) VALUES (?, ?, ?)', [plan.sessionId, plan.revision, JSON.stringify(plan)], executor);
  else {
    const rows = await queryDatabase('UPDATE workflow_plan SET revision = ?, record_json = ? WHERE session_id = ? AND revision = ? RETURNING session_id', [plan.revision, JSON.stringify(plan), plan.sessionId, previous], executor);
    if (!rows.length) throw new Error('Plan changed. Read the current revision before retrying.');
  }
  await executeDatabase('INSERT INTO workflow_event (id, session_id, revision, record_json) VALUES (?, ?, ?, ?)', [randomUUID(), plan.sessionId, plan.revision, JSON.stringify(event)], executor);
}

export function workflowContinuationState(plan: WorkflowPlan) {
  const stage = plan.stages[plan.stageIndex];
  const currentItem = stage.items.find(i => i.id === plan.currentItemId);
  return { revision: plan.revision, status: plan.status, currentItemId: plan.currentItemId, feedback: plan.feedback,
    currentItem: currentItem && { id: currentItem.id, title: currentItem.title, source: currentItem.source, checks: currentItem.checks.map(c => ({ id: c.id, label: c.label, status: c.status, evidenceRequired: c.evidenceRequired, result: c.result.slice(0, 1500), evidenceIds: c.evidence.map(e => e.toolCallId) })) },
    recordedResults: plan.stages.flatMap(s => s.items.flatMap(i => i.checks.filter(c => c.result).map(c => ({ itemId: i.id, checkId: c.id, status: c.status, result: c.result.slice(0, 1500), evidenceIds: c.evidence.map(e => e.toolCallId) })))).slice(-8),
    currentStage: { id: stage.id, title: stage.title, items: stage.items.map(i => ({ id: i.id, title: i.title, source: i.source.slice(0, 240), ready: ready(plan, i), dependsOn: i.dependsOn, checks: i.checks.map(c => ({ id: c.id, label: c.label, status: c.status, evidenceRequired: c.evidenceRequired })) })) },
    stages: plan.stages.map(s => ({ id: s.id, title: s.title, itemCount: s.items.length })),
    nextAction: plan.status === 'awaiting_review' ? 'Stage snapshot awaits user review; a reply does not change this state.' : 'Use current revision for changes. In-progress independent items may be revisited. A reply does not change plan status.' };
}
async function availableEvidence(sessionId: string, query = '') {
  const rows = await queryDatabase<{record_json: string}>('SELECT record_json FROM browser_chat_step WHERE session_id = ? ORDER BY step_index ASC', [sessionId]);
  const traces = rows.flatMap(row => JSON.parse(row.record_json).tools || []) as Array<{id: string; name: string; reason?: string; result?: unknown}>;
  return traces.filter(t => !['workflow', 'finalResponse'].includes(t.name) && (!query || JSON.stringify(t).toLowerCase().includes(query.toLowerCase()))).slice(-20).map(t => ({toolCallId: t.id, name: t.name, description: t.reason, result: String(typeof t.result === 'string' ? t.result : JSON.stringify(t.result)).slice(0, 600)}));
}

export async function executeWorkflow(sessionId: string, raw: unknown) {
  try {
    const input = workflowInputSchema.parse(raw);
    if (input.action === 'read') {
      const plan = await readWorkflow(sessionId);
      return { ok: true, actual: JSON.stringify({ ...(plan ? workflowContinuationState(plan) : { registered: false, revision: 0 }), item: input.itemId ? plan && allItems(plan).find(i => i.id === input.itemId) : undefined, stage: input.stageId ? plan?.stages.find(s => s.id === input.stageId) : undefined, availableEvidence: await availableEvidence(sessionId, input.query) }) };
    }
    const plan = await runDatabaseTransaction(async manager => {
      let plan = await readWorkflow(sessionId, manager);
      const previous = plan?.revision || 0;
      if (input.expectedRevision !== previous) throw new Error(`Revision conflict. Read workflow first; current revision ${previous}.`);
      if (input.action === 'register') {
        if (plan && !['completed', 'cancelled'].includes(plan.status)) throw new Error('A plan already exists. Active registered scope cannot be replaced.');
        if (!input.title || !input.stages) throw new Error('title and complete stages required');
        const stages = input.stages.map(s => ({ ...s, items: s.items.map(i => ({ ...i, checks: i.checks.map(c => ({ ...c, status: 'pending' as const, result: '', evidence: [] })) })) }));
        const seen = new Set<string>(); const stageIds = new Set<string>();
        for (const stage of stages) {
          if (stageIds.has(stage.id)) throw new Error('Duplicate stage ID'); stageIds.add(stage.id);
          for (const item of stage.items) {
            if (seen.has(item.id) || item.dependsOn.some(d => !seen.has(d))) throw new Error('Item IDs must be unique and dependencies must precede their consumer.');
            if (new Set(item.checks.map(c => c.id)).size !== item.checks.length) throw new Error('Duplicate check ID');
            seen.add(item.id);
          }
        }
        plan = { sessionId, title: input.title, revision: 0, stageIndex: 0, status: 'active', stages, submissions: [], updatedAt: '' };
      } else {
        if (!plan || plan.status !== 'active') throw new Error('This plan is not active. Read its state before updating stage items.');
        const stage = plan.stages[plan.stageIndex];
        if (input.action === 'appendItems') {
          const targetIndex = plan.stages.findIndex(s => s.id === input.stageId);
          if (targetIndex < plan.stageIndex || !input.items) throw new Error('Append only to the active or future stage, with source references for the added requirements.');
          const seen = new Set(plan.stages.slice(0, targetIndex + 1).flatMap(s => s.items.map(i => i.id)));
          const all = new Set(allItems(plan).map(i => i.id));
          for (const item of input.items) {
            if (all.has(item.id) || item.dependsOn.some(d => !seen.has(d)) || new Set(item.checks.map(c => c.id)).size !== item.checks.length) throw new Error('Invalid or duplicate appended item/check or dependency.');
            seen.add(item.id); all.add(item.id);
            plan.stages[targetIndex].items.push({ ...item, checks: item.checks.map(c => ({ ...c, status: 'pending', result: '', evidence: [] })) });
          }
        } else if (input.action === 'submitStage') {
          const remaining = stage.items.filter(unfinished);
          if (!input.summary?.trim()) throw new Error('Provide a reviewable summary.');
          const gaps = stage.items.flatMap(i => i.checks.filter(c => ['pending', 'running', 'blocked', 'not_applicable'].includes(c.status)).map(c => `${i.id}/${c.id}: ${c.result}`));
          plan.submissions.push({ id: randomUUID(), revision: previous + 1, stageId: stage.id, summary: input.summary, gaps, items: structuredClone(stage.items) });
          if (stage.confirmationRequired) { plan.status = 'awaiting_review'; plan.currentItemId = undefined; }
          else if (!remaining.length) {
            plan.currentItemId = undefined;
            if (plan.stageIndex === plan.stages.length - 1) plan.status = 'completed';
            else plan.stageIndex += 1;
          }
        } else {
          const item = stage.items.find(i => i.id === input.itemId);
          if (!item) throw new Error('Item must belong to the current stage.');
          if (input.action === 'beginItem') {
            if (!ready(plan, item)) throw new Error('Prerequisites not passed. Work on prerequisites or record a blocker.');
            plan.currentItemId = item.id;
            item.checks.filter(c => c.status === 'pending').forEach(c => { c.status = 'running'; });
          } else {
            const check = item.checks.find(c => c.id === input.checkId);
            if (!check || !input.status) throw new Error('checkId and status required');
            if (['passed', 'failed'].includes(input.status) && !ready(plan, item)) throw new Error('Declared prerequisites are not satisfied.');
            if (!input.result?.trim()) throw new Error('Actual result or concrete blocker required.');
            const evidence: WorkflowCheck['evidence'] = input.evidence || [];
            if (check.evidenceRequired && ['passed', 'failed'].includes(input.status) && !evidence.length) throw new Error('Required tool evidence missing.');
            if (evidence.length) {
              const rows = await queryDatabase<{ record_json: string }>('SELECT record_json FROM browser_chat_step WHERE session_id = ?', [sessionId], manager);
              const tools = rows.flatMap(row => (JSON.parse(row.record_json).tools || [])) as Array<{ id: string; name: string; result?: string; screenshots?: Array<{ url?: string; title?: string }> }>;
              for (const entry of evidence) {
                const trace = tools.find(t => t.id === entry.toolCallId && t.name !== 'workflow' && t.name !== 'finalResponse');
                if (!trace) throw new Error('Evidence must reference a persisted operational tool call in this session.');
                entry.sourceSummary = typeof trace.result === 'string' ? trace.result.slice(0, 2000) : '';
                entry.screenshots = (trace.screenshots || []).flatMap(s => s.url && s.url.startsWith('/') ? [{ url: s.url, title: s.title || '截图证据' }] : []);
              }
            }
            check.status = input.status; check.result = input.result; check.evidence = evidence;
            if (plan.currentItemId === item.id && !unfinished(item)) plan.currentItemId = undefined;
          }
        }
      }
      await commit(plan!, previous, { actor: 'model', input }, manager);
      return plan!;
    });
    return { ok: true, actual: JSON.stringify(workflowContinuationState(plan)) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const current = await readWorkflow(sessionId).catch(() => undefined);
    return { ok: false, actual: JSON.stringify({ error: message, ...(current ? workflowContinuationState(current) : { revision: 0 }), recovery: 'Call read (optionally query) for real evidence IDs. Correct the listed parameters; do not repeat the rejected input.' }) };
  }
}

export async function reviewWorkflow(sessionId: string, userId: string, revision: number, submissionId: string, decision: 'approve' | 'accept_with_gaps' | 'request_changes' | 'cancel', feedback: string, reopenIds: string[]) {
  return runDatabaseTransaction(async manager => {
    const plan = await readWorkflow(sessionId, manager);
    if (!plan) throw new Error('Plan not found');
    const submission = plan.submissions.at(-1);
    if (submission?.id === submissionId && submission.decision === decision && submission.reviewedBy === userId) return plan;
    if (plan.revision !== revision || plan.status !== 'awaiting_review' || submission?.id !== submissionId) throw new Error('Review is outdated. Refresh the current submission.');
    if (decision === 'approve' && submission.gaps.length) throw new Error('This submission contains gaps. Explicit acceptance is required.');
    if (decision === 'request_changes') {
      if (!feedback.trim() || !reopenIds.length) throw new Error('Select affected items and describe the changes.');
      const stage = plan.stages[plan.stageIndex];
      if (reopenIds.some(id => !stage.items.some(i => i.id === id))) throw new Error('Invalid item ID');
      const affected = new Set(reopenIds);
      for (const item of stage.items) if (item.dependsOn.some(id => affected.has(id))) affected.add(item.id);
      for (const item of stage.items.filter(i => affected.has(i.id))) for (const check of item.checks) { check.status = 'pending'; check.result = ''; check.evidence = []; }
      plan.feedback = feedback; plan.status = 'active';
    } else if (decision === 'cancel') plan.status = 'cancelled';
    else if (plan.stageIndex === plan.stages.length - 1) plan.status = 'completed';
    else { plan.stageIndex += 1; plan.status = 'active'; plan.feedback = undefined; }
    submission.decision = decision; submission.feedback = feedback; submission.reviewedBy = userId;
    await commit(plan, revision, { actor: userId, submissionId, decision, feedback, reopenIds }, manager);
    return plan;
  });
}

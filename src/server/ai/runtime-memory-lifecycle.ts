import { workspaceRecords } from '../storage/record-sources';
import { runtimeSetting } from '@/server/settings/runtime-configuration';
import { createHash, randomUUID } from 'node:crypto';
import { queryDatabase, queryDatabaseOne, executeDatabase, type DatabaseExecutor } from '@/server/db/database';
import { commitPersonalMemoryReview } from '@/server/storage/database-record-store';
import { personalMemoryExtractionEnabled, type PersonalMemoryItem, type PersonalMemoryExtractionResult } from './personal-memory';
import { withModelSettings, type ModelSettingsOverride } from './model';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';


type Candidate = { userId: string; sourceKey: string; expectedContentHash: string; items: PersonalMemoryItem[] };
export async function proposeReviewedMemory(sessionId: string, candidate: Candidate) {
  const id = createHash('sha256').update(`${candidate.userId}:${candidate.sourceKey}`).digest('hex');
  await executeDatabase(`INSERT INTO workspace_record (collection,container_kind,partition_id, kind, id, container_id, status, record_json)
    VALUES ('memory','chat',?, 'candidate', ?, ?, 'candidate', ?) ON CONFLICT(collection,partition_id,kind,scope_id,id) DO NOTHING`, [candidate.userId, id, sessionId, JSON.stringify(candidate)]);
  return id;
}
export async function listMemoryCandidates(sessionId: string, userId: string) {
  const rows = await queryDatabase<{ id: string; record_json: string }>(`SELECT id, record_json FROM ${workspaceRecords('memory')} WHERE kind='candidate' AND session_id = ? AND user_id = ? AND status = 'candidate'`, [sessionId, userId]);
  return rows.map(row => ({ id: row.id, items: (JSON.parse(row.record_json) as Candidate).items }));
}
export async function reviewMemoryProposal(sessionId: string, userId: string, id: string, approved: boolean) {
  const row = await queryDatabaseOne<{ record_json: string; status: string }>(`SELECT record_json, status FROM ${workspaceRecords('memory')} WHERE kind='candidate' AND id = ? AND session_id = ? AND user_id = ?`, [id, sessionId, userId]);
  if (!row || row.status !== 'candidate') throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Memory proposal is unavailable or already reviewed.');
  const finish = async (status: 'approved' | 'deleted', executor?: DatabaseExecutor) => {
    const changed = await queryDatabase(`UPDATE workspace_record SET status = ?, record_json = '{}'
      WHERE collection='memory' AND kind='candidate' AND id = ? AND partition_id = ? AND container_id = ? AND status = 'candidate' RETURNING id`,
    [status, id, userId, sessionId], executor);
    if (!changed.length) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Proposal changed during review.');
  };
  if (!approved) { await finish('deleted'); return; }
  const candidate = JSON.parse(row.record_json) as Candidate;
  if (candidate.items.some(item => item.expiresAt && Date.parse(item.expiresAt) <= Date.now())) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Proposal has expired.');
  const result = await commitPersonalMemoryReview({ ...candidate, afterCommit: executor => finish('approved', executor) });
  if (result === 'duplicate') await finish('approved');
  if (result === 'conflict') throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Memory changed since this proposal. Request a new proposal.');
}
export type MemoryJobPayload = Omit<Parameters<typeof import('./personal-memory-learning').extractPersonalMemoryFromTurn>[0], 'abortSignal'> & {
  modelSettings?: ModelSettingsOverride;
};
export async function enqueueMemoryJob(payload: MemoryJobPayload, retryFailed = false) {
  const userId = String(payload.userId), id = createHash('sha256').update(`${userId}:${payload.sourceSessionId}:${payload.sourceMessageIds.join(':')}`).digest('hex');
  await executeDatabase(`INSERT INTO workspace_record (collection,container_kind,partition_id, kind, id, container_id, status, available_at, record_json)
    VALUES ('memory','chat',?, 'job', ?, ?, 'queued', ?, ?) ON CONFLICT(collection,partition_id,kind,scope_id,id) DO NOTHING`, [userId, id, payload.sourceSessionId, Date.now(), JSON.stringify(payload)]);
  if (retryFailed) await executeDatabase(`UPDATE workspace_record SET status = 'queued', attempts = 0, available_at = ?, lease_id = NULL, lease_until = 0, error = NULL, result_json = NULL, record_json = ? WHERE collection='memory' AND kind='job' AND partition_id = ? AND id = ? AND status = 'failed'`, [Date.now(), JSON.stringify(payload), userId, id]);
  return id;
}
export async function listMemoryJobs(sessionId: string, userId: string) {
  const rows = await queryDatabase<{ id: string; status: string; attempts: number; error: string | null; result_json: string | null }>(
    `SELECT id, status, attempts, error, result_json FROM ${workspaceRecords('memory')} WHERE kind='job' AND session_id = ? AND user_id = ? ORDER BY available_at DESC LIMIT 20`, [sessionId, userId]);
  return rows.map(({ result_json, ...row }) => ({ ...row, result: result_json ? JSON.parse(result_json) as PersonalMemoryExtractionResult : undefined }));
}
/** Host invokes workers explicitly. Leases survive process death; retries never run in model assembly. */
export async function runMemoryJobs(sessionId: string, userId: string, abortSignal?: AbortSignal) {
  const now = Date.now(), leaseId = randomUUID();
  const rows = await queryDatabase<{ id: string; attempts: number; record_json: string }>(`UPDATE workspace_record
    SET status = 'running', attempts = attempts + 1, lease_id = ?, lease_until = ?
    WHERE collection='memory' AND kind='job' AND partition_id = ? AND id = (SELECT id FROM workspace_record WHERE collection='memory' AND kind='job' AND container_id = ? AND partition_id = ? AND attempts < 4 AND available_at <= ?
      AND (status = 'queued' OR (status = 'running' AND lease_until < ?)) ORDER BY available_at LIMIT 1)
    AND (status = 'queued' OR (status = 'running' AND lease_until < ?)) RETURNING id, attempts, record_json`,
  [leaseId, now + 360000, userId, sessionId, userId, now, now, now]);
  if (!rows.length) return { processed: false };
  const job = rows[0];
  try {
    const { extractPersonalMemoryFromTurn } = await import('./personal-memory-learning');
    const { modelSettings, ...payload } = JSON.parse(job.record_json) as MemoryJobPayload;
    const signal = AbortSignal.any([AbortSignal.timeout(300000), ...(abortSignal ? [abortSignal] : [])]);
    const result = await withModelSettings(modelSettings || {}, () => extractPersonalMemoryFromTurn({ ...payload, abortSignal: signal }));
    const finished = await queryDatabase(`UPDATE workspace_record SET status = 'completed', lease_until = 0, lease_id = NULL, error = NULL, record_json = '{}', result_json = ? WHERE collection='memory' AND kind='job' AND partition_id = ? AND id = ? AND lease_id = ? AND status='running' RETURNING id`, [JSON.stringify(result), userId, job.id, leaseId]);
    if (!finished.length) return { processed: false };
    return { processed: true, id: job.id, result };
  } catch (error) {
    await executeDatabase(`UPDATE workspace_record SET status = ?, available_at = ?, lease_until = 0, lease_id = NULL, error = ?,
      record_json = CASE WHEN attempts >= 4 THEN '{}' ELSE record_json END
      WHERE collection='memory' AND kind='job' AND partition_id = ? AND id = ? AND lease_id = ? AND status='running'`,
    [job.attempts >= 4 ? 'failed' : 'queued', Date.now() + 1000 * 2 ** job.attempts, String(error), userId, job.id, leaseId]);
    throw error;
  }
}

/** One execution-process worker, bounded across users and serialized per user. */
export function startMemoryExtractionWorker() {
  const controller = new AbortController();
  const active = new Map<string, Promise<unknown>>();
  let polling = false;
  const poll = async () => {
    if (polling || controller.signal.aborted || !personalMemoryExtractionEnabled()) return;
    polling = true;
    try {
      const configured = Number(runtimeSetting("AI_PERSONAL_MEMORY_EXTRACTION_CONCURRENCY") || 2);
      const concurrency = Number.isFinite(configured) ? Math.min(8, Math.max(1, Math.floor(configured))) : 2;
      const now = Date.now();
      await executeDatabase(`UPDATE workspace_record SET status = 'failed', lease_until = 0, lease_id = NULL, record_json = '{}', error = 'Memory extraction worker was interrupted after the final attempt.' WHERE collection='memory' AND kind='job' AND status = 'running' AND lease_until < ? AND attempts >= 4`, [now]);
      const jobs = await queryDatabase<{ session_id: string; user_id: string }>(
        `SELECT session_id, user_id FROM ${workspaceRecords('memory')} j WHERE kind='job' AND attempts < 4 AND available_at <= ? AND (status = 'queued' OR (status = 'running' AND lease_until < ?)) AND NOT EXISTS (SELECT 1 FROM ${workspaceRecords('memory')} running WHERE running.kind='job' AND running.user_id = j.user_id AND running.status = 'running' AND running.lease_until >= ?) ORDER BY available_at LIMIT 100`, [now, now, now]);
      for (const job of jobs) {
        if (controller.signal.aborted || active.size >= concurrency) break;
        if (active.has(job.user_id)) continue;
        const operation = runMemoryJobs(job.session_id, job.user_id, controller.signal)
          .catch(error => { if (!controller.signal.aborted) console.error('[memory-extraction] Attempt failed; persisted for bounded retry.', error); })
          .finally(() => { active.delete(job.user_id); });
        active.set(job.user_id, operation);
      }
    } catch (error) {
      if (!controller.signal.aborted) console.error('[memory-extraction] Queue polling failed.', error);
    } finally { polling = false; }
  };
  const timer = setInterval(() => { void poll(); }, 3000);
  timer.unref();
  void poll();
  return async () => {
    clearInterval(timer);
    controller.abort();
    await Promise.allSettled(active.values());
  };
}

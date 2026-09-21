import { createHash, randomUUID } from 'node:crypto';
import { queryDatabase, queryDatabaseOne, executeDatabase } from '@/server/db/database';
import { commitPersonalMemoryReview } from '@/server/storage/database-record-store';
import type { PersonalMemoryItem } from './personal-memory';

type Candidate = { userId: string; sourceKey: string; expectedItems: PersonalMemoryItem[]; items: PersonalMemoryItem[]; report: unknown };
export async function proposeReviewedMemory(sessionId: string, candidate: Candidate) {
  const id = createHash('sha256').update(`${candidate.userId}:${candidate.sourceKey}`).digest('hex');
  await executeDatabase('INSERT INTO agent_memory_candidate (id, user_id, session_id, source_key, status, record_json) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, source_key) DO NOTHING', [id, candidate.userId, sessionId, candidate.sourceKey, 'candidate', JSON.stringify(candidate)]);
  return id;
}
export async function listMemoryCandidates(sessionId: string, userId: string) {
  const rows = await queryDatabase<{ id: string; record_json: string }>("SELECT id, record_json FROM agent_memory_candidate WHERE session_id = ? AND user_id = ? AND status = 'candidate'", [sessionId, userId]);
  return rows.map(row => ({ id: row.id, items: (JSON.parse(row.record_json) as Candidate).items }));
}
export async function reviewMemoryProposal(sessionId: string, userId: string, id: string, approved: boolean) {
  const row = await queryDatabaseOne<{ record_json: string; status: string }>('SELECT record_json, status FROM agent_memory_candidate WHERE id = ? AND session_id = ? AND user_id = ?', [id, sessionId, userId]);
  if (!row || row.status !== 'candidate') throw new Error('Memory proposal is unavailable or already reviewed.');
  if (!approved) { await executeDatabase("UPDATE agent_memory_candidate SET status = 'deleted' WHERE id = ? AND status = 'candidate'", [id]); return; }
  const candidate = JSON.parse(row.record_json) as Candidate;
  if (candidate.items.some(item => item.expiresAt && Date.parse(item.expiresAt) <= Date.now())) throw new Error('Proposal has expired.');
  const result = await commitPersonalMemoryReview({ ...candidate, afterCommit: async executor => {
    const changed = await queryDatabase("UPDATE agent_memory_candidate SET status = 'approved' WHERE id = ? AND status = 'candidate' RETURNING id", [id], executor);
    if (!changed.length) throw new Error('Proposal changed during approval.');
  } });
  if (result === 'conflict') throw new Error('Memory changed since this proposal. Request a new proposal.');
}
export type MemoryJobPayload = Omit<Parameters<typeof import('./personal-memory-learning').extractPersonalMemoryFromTurn>[0], 'abortSignal'>;
export async function enqueueMemoryJob(payload: MemoryJobPayload) {
  const userId = String(payload.userId), id = createHash('sha256').update(`${userId}:${payload.sourceSessionId}:${payload.sourceMessageIds.join(':')}`).digest('hex');
  await executeDatabase('INSERT INTO agent_memory_job (id, user_id, session_id, status, attempts, available_at, lease_until, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING', [id, userId, payload.sourceSessionId, 'queued', 0, Date.now(), 0, JSON.stringify(payload)]);
  return id;
}
/** Host invokes workers explicitly. Leases survive process death; retries never run in model assembly. */
export async function runMemoryJobs(sessionId: string, userId: string) {
  const now = Date.now(), leaseId = randomUUID();
  const rows = await queryDatabase<{ id: string; attempts: number; payload_json: string }>("UPDATE agent_memory_job SET status = 'running', attempts = attempts + 1, lease_id = ?, lease_until = ? WHERE id = (SELECT id FROM agent_memory_job WHERE session_id = ? AND user_id = ? AND attempts < 4 AND available_at <= ? AND (status = 'queued' OR (status = 'running' AND lease_until < ?)) ORDER BY available_at LIMIT 1) AND (status = 'queued' OR (status = 'running' AND lease_until < ?)) RETURNING id, attempts, payload_json", [leaseId, now + 360000, sessionId, userId, now, now, now]);
  if (!rows.length) return { processed: false };
  const job = rows[0];
  try {
    const { extractPersonalMemoryFromTurn } = await import('./personal-memory-learning');
    await extractPersonalMemoryFromTurn({ ...JSON.parse(job.payload_json), abortSignal: AbortSignal.timeout(300000) });
    await executeDatabase("UPDATE agent_memory_job SET status = 'completed', lease_until = 0 WHERE id = ? AND lease_id = ?", [job.id, leaseId]);
    return { processed: true, id: job.id };
  } catch (error) {
    await executeDatabase("UPDATE agent_memory_job SET status = ?, available_at = ?, lease_until = 0, error = ? WHERE id = ? AND lease_id = ?", [job.attempts >= 4 ? 'failed' : 'queued', Date.now() + 1000 * 2 ** job.attempts, String(error), job.id, leaseId]);
    throw error;
  }
}

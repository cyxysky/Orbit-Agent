import { createHash } from 'node:crypto';
import { executeDatabase, queryDatabase, queryDatabaseOne, runDatabaseTransaction } from '@/server/db/database';
import { ApiRequestError, apiJson } from './api-request';
import { incrementMetric } from '@/server/observability/runtime-observability';
import { queueDatabaseWrite } from '@/server/storage/database-write-queue';
import { ERROR_CODES } from '@cjfclonedeep/capability-sdk';


type IdempotencyRow = {
  request_hash: string;
  response_json?: string | null;
  state: string;
  status_code?: number | null;
};

const cleanupState = ((globalThis as typeof globalThis & {
  __apiIdempotencyCleanupState?: { lastAt: number };
}).__apiIdempotencyCleanupState ??= { lastAt: 0 });

function scheduleExpiredClaimCleanup(timestamp: string) {
  if (Date.now() - cleanupState.lastAt < 60 * 60 * 1000) return;
  cleanupState.lastAt = Date.now();
  void queueDatabaseWrite([{
    sql: 'DELETE FROM request_record WHERE expires_at <= ?',
    params: [timestamp],
  }]).catch(() => {
    cleanupState.lastAt = 0;
  });
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, stableValue(item)]));
}

export function idempotencyFingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function idempotencyTtlMs() {
  const configured = Number(process.env.API_IDEMPOTENCY_TTL_MS || 24 * 60 * 60 * 1000);
  return Number.isFinite(configured)
    ? Math.max(60_000, Math.min(7 * 24 * 60 * 60 * 1000, Math.floor(configured)))
    : 24 * 60 * 60 * 1000;
}

export async function runIdempotentJson(
  request: Request,
  input: { fingerprint: string; scope: string; userId: string },
  operation: () => Promise<Response> | Response,
) {
  const key = String(request.headers.get('idempotency-key') || '').trim();
  if (!key) return operation();
  if (!/^[a-zA-Z0-9._:-]{8,200}$/.test(key)) {
    throw new ApiRequestError('Idempotency-Key is invalid', { code: ERROR_CODES.INVALID_IDEMPOTENCY_KEY });
  }
  const timestamp = new Date();
  const expiresAt = new Date(timestamp.getTime() + idempotencyTtlMs()).toISOString();
  const claim = await runDatabaseTransaction(async (database) => {
    await executeDatabase(`
      DELETE FROM request_record
      WHERE kind='idempotency' AND user_id = ? AND scope = ? AND id = ? AND expires_at <= ?
    `, [input.userId, input.scope, key, timestamp.toISOString()], database);
    const inserted = await queryDatabase<{ user_id: string }>(`
      INSERT INTO request_record (
        user_id, kind, scope, id, request_hash, state, expires_at, created_at, updated_at
      ) VALUES (?, 'idempotency', ?, ?, ?, 'pending', ?, ?, ?)
      ON CONFLICT(user_id, kind, scope, id) DO NOTHING
      RETURNING user_id
    `, [input.userId, input.scope, key, input.fingerprint, expiresAt, timestamp.toISOString(), timestamp.toISOString()], database);
    if (inserted.length) return { owned: true as const };
    const row = await queryDatabaseOne<IdempotencyRow>(`
      SELECT request_hash, response_json, state, status_code
      FROM request_record
      WHERE kind='idempotency' AND user_id = ? AND scope = ? AND id = ?
    `, [input.userId, input.scope, key], database);
    return { owned: false as const, row };
  });
  if (!claim.owned) {
    scheduleExpiredClaimCleanup(timestamp.toISOString());
    if (!claim.row || claim.row.request_hash !== input.fingerprint) {
      incrementMetric('api_idempotency_conflict_total', { scope: input.scope });
      throw new ApiRequestError('Idempotency-Key was already used with a different request', {
        code: ERROR_CODES.IDEMPOTENCY_CONFLICT,
        status: 409,
      });
    }
    if (claim.row.state !== 'completed' || !claim.row.response_json) {
      throw new ApiRequestError('An identical request is still being processed', {
        code: ERROR_CODES.REQUEST_IN_PROGRESS,
        status: 409,
      });
    }
    incrementMetric('api_idempotency_replay_total', { scope: input.scope });
    return apiJson(request, JSON.parse(claim.row.response_json), {
      status: claim.row.status_code || 200,
      headers: { 'x-idempotency-replayed': '1' },
    });
  }

  try {
    const response = await operation();
    if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
      const responseJson = await response.clone().text();
      await executeDatabase(`
        UPDATE request_record
        SET state = 'completed', status_code = ?, response_json = ?, updated_at = ?
        WHERE kind='idempotency' AND user_id = ? AND scope = ? AND id = ? AND request_hash = ?
      `, [
        response.status,
        responseJson,
        new Date().toISOString(),
        input.userId,
        input.scope,
        key,
        input.fingerprint,
      ]);
    } else {
      await executeDatabase(`
        DELETE FROM request_record WHERE kind='idempotency' AND user_id = ? AND scope = ? AND id = ?
      `, [input.userId, input.scope, key]);
    }
    scheduleExpiredClaimCleanup(timestamp.toISOString());
    return response;
  } catch (error) {
    await executeDatabase(`
      DELETE FROM request_record WHERE kind='idempotency' AND user_id = ? AND scope = ? AND id = ?
    `, [input.userId, input.scope, key]);
    scheduleExpiredClaimCleanup(timestamp.toISOString());
    throw error;
  }
}

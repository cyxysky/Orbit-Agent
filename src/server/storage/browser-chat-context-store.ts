import { databaseDriver, sqliteDatabasePath, queryDatabase } from '@/server/db/database';
import type { DatabaseWriteStatement } from './database-write-queue';

type ContextSnapshot = { modelContext?: {
  version?: number; records?: Record<string, unknown>; history?: string[]; active?: string[]; externalRecords?: boolean;
  recordIds?: string[]; continuationSummary?: string;
  lastRequest?: { id: string }; branches?: Record<string, { lastRequest?: { id: string }; active?: string[]; continuationSummary?: string }>;
} };

// Populate only after a successful commit/read. A failed queued transaction must
// never make a later checkpoint skip records that were rolled back.
const committedRecords = new Map<string, Set<string>>();
function cacheKey(sessionId: string) {
  return `${databaseDriver() === 'sqlite' ? sqliteDatabasePath() : process.env.DATABASE_URL}/${sessionId}`;
}
export function markBrowserChatContextWritten<T>(sessionId: string, snapshot: T) {
  const context = (snapshot as ContextSnapshot).modelContext;
  if (!context?.records) return;
  const key = cacheKey(sessionId);
  const known = committedRecords.get(key) || new Set<string>();
  for (const id of Object.keys(context.records)) known.add(id);
  committedRecords.delete(key);
  committedRecords.set(key, known);
  if (committedRecords.size > 128) committedRecords.delete(committedRecords.keys().next().value!);
}

/** Header and immutable records must be committed in the SAME transaction. */
export function splitBrowserChatContextSnapshot<T>(sessionId: string, snapshot: T) {
  const context = (snapshot as ContextSnapshot).modelContext;
  if (context?.version !== 2 || !context.records) return { snapshot, statements: [] as DatabaseWriteStatement[] };
  const { records, ...index } = context;
  const known = committedRecords.get(cacheKey(sessionId));
  const compactions: DatabaseWriteStatement[] = Object.entries({ main: context, ...context.branches }).flatMap(([scopeId, view]) => {
    let state: { version?: number; epoch?: number };
    try { state = JSON.parse(view.continuationSummary || '{}'); } catch { return []; }
    if (state.version !== 3 || !state.epoch) return [];
    return [{ sql: 'INSERT INTO agent_runtime_compaction (session_id, scope_id, epoch, snapshot_json) VALUES (?, ?, ?, ?) ON CONFLICT(session_id, scope_id, epoch) DO NOTHING',
      params: [sessionId, scopeId, state.epoch, JSON.stringify({ active: view.active, continuationSummary: view.continuationSummary })] }];
  });
  return {
    snapshot: { ...snapshot, modelContext: { ...index, recordIds: Object.keys(records), externalRecords: true } },
    statements: [...compactions, ...Object.entries(records).filter(([id]) => !known?.has(id)).map(([id, value]) => ({
      sql: `INSERT INTO browser_chat_context_record (session_id, id, record_json) VALUES (?, ?, ?)
        ON CONFLICT(session_id, id) DO NOTHING`,
      params: [sessionId, id, JSON.stringify(value)],
    })), ...[context.lastRequest, ...Object.values(context.branches || {}).map((branch) => branch.lastRequest)]
      .flatMap((manifest) => manifest ? [{
        sql: `INSERT INTO browser_chat_context_request (session_id, id, manifest_json) VALUES (?, ?, ?)
          ON CONFLICT(session_id, id) DO NOTHING`,
        params: [sessionId, manifest.id, JSON.stringify(manifest)],
      }] : [])],
  };
}

export async function hydrateBrowserChatContextSnapshot<T>(sessionId: string, snapshot: T): Promise<T> {
  const context = (snapshot as ContextSnapshot)?.modelContext;
  if (context?.version !== 2 || !context.externalRecords) return snapshot;
  const rows = await queryDatabase<{ id: string; record_json: string }>(
    'SELECT id, record_json FROM browser_chat_context_record WHERE session_id = ?', [sessionId],
  );
  const recordIds = context.recordIds ? new Set(context.recordIds) : undefined;
  const records = Object.fromEntries(rows.filter((row) => !recordIds || recordIds.has(row.id)).map((row) => [row.id, JSON.parse(row.record_json)]));
  const missing = [...(context.recordIds || []), ...(context.history || []), ...(context.active || [])].find((id) => !Object.hasOwn(records, id));
  if (missing) throw new Error(`Missing durable browser-chat context record: ${missing}`);
  const { externalRecords: _external, recordIds: _recordIds, ...index } = context;
  void _external; void _recordIds;
  const restored = { ...snapshot, modelContext: { ...index, records } };
  markBrowserChatContextWritten(sessionId, restored);
  return restored;
}

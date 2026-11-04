import { databaseDriver, sqliteDatabasePath, queryDatabase } from '@/server/db/database';
import type { DatabaseWriteStatement } from './database-write-queue';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';
import { runtimeOwnerStatement } from './runtime-owner';


type ContextView = {
  recordIds?: string[]; history?: string[]; active?: string[]; backgroundRef?: string; continuationSummary?: string;
  lastRequest?: { id: string; systemRef?: string; toolSchemaRef?: string; backgroundRef?: string; messageRefs?: string[] };
};
type ContextSnapshot = { modelContext?: ContextView & {
  version?: number; records?: Record<string, unknown>; history?: string[]; active?: string[]; externalRecords?: boolean;
  recordIds?: string[]; continuationSummary?: string;
  branches?: Record<string, ContextView>;
} };

// Populate only after a successful commit/read. A failed queued transaction must
// never make a later checkpoint skip records that were rolled back.
const committedRecords = new Map<string, Set<string>>();
const maxCommittedRecordIds = 32_768;
let committedRecordCount = 0;
function forgetCommittedRecords(key: string) {
  committedRecordCount -= committedRecords.get(key)?.size || 0;
  committedRecords.delete(key);
}
function cacheKey(sessionId: string) {
  return `${databaseDriver() === 'sqlite' ? sqliteDatabasePath() : process.env.DATABASE_URL}/${sessionId}`;
}
export function markBrowserChatContextWritten<T>(sessionId: string, snapshot: T) {
  const context = (snapshot as ContextSnapshot).modelContext;
  if (!context?.records) return;
  const key = cacheKey(sessionId);
  const known = committedRecords.get(key) || new Set<string>();
  forgetCommittedRecords(key);
  for (const id of Object.keys(context.records)) known.add(id);
  // This is only an insert-deduplication cache. Eviction safely falls back to ON CONFLICT.
  if (known.size > maxCommittedRecordIds) return;
  committedRecords.set(key, known);
  committedRecordCount += known.size;
  while (committedRecords.size > 128 || committedRecordCount > maxCommittedRecordIds) forgetCommittedRecords(committedRecords.keys().next().value!);
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
    statements: [...(compactions.length ? [runtimeOwnerStatement(sessionId)] : []), ...compactions, ...Object.entries(records).filter(([id]) => !known?.has(id)).map(([id, value]) => ({
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
  const records: Record<string, unknown> = {};
  const readRecords = async (ids?: string[]) => {
    const rows = await queryDatabase<{ id: string; record_json: string }>(
      `SELECT id, record_json FROM browser_chat_context_record WHERE session_id = ?${ids ? ` AND id IN (${ids.map(() => '?').join(',')})` : ''}`,
      [sessionId, ...(ids || [])],
    );
    for (const row of rows) records[row.id] = JSON.parse(row.record_json);
  };
  if (context.recordIds) {
    // Do not materialize archived records only to discard them in JavaScript.
    for (let offset = 0; offset < context.recordIds.length; offset += 256) await readRecords(context.recordIds.slice(offset, offset + 256));
  } else await readRecords();
  const referenced = Object.values({ main: context, ...context.branches }).flatMap(view => {
    const manifest = view.lastRequest;
    let state: { handoffRef?: string; pinnedUserRef?: string } = {};
    if (view.continuationSummary) state = JSON.parse(view.continuationSummary);
    return [...(view.recordIds || []), ...(view.history || []), ...(view.active || []), ...(manifest?.messageRefs || []),
      view.backgroundRef, manifest?.systemRef, manifest?.toolSchemaRef, manifest?.backgroundRef, state.handoffRef, state.pinnedUserRef]
      .filter((ref): ref is string => Boolean(ref));
  });
  const missing = referenced.find((id) => !Object.hasOwn(records, id));
  if (missing) throw new CodedError(ERROR_CODES.STORAGE_OPERATION_FAILED, `Missing durable browser-chat context record: ${missing}`);
  const { externalRecords: _external, recordIds: _recordIds, ...index } = context;
  void _external; void _recordIds;
  const restored = { ...snapshot, modelContext: { ...index, records } };
  markBrowserChatContextWritten(sessionId, restored);
  return restored;
}

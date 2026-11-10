import type { MigrationInterface, QueryRunner } from 'typeorm';
import { memoryContentHash } from '@/server/storage/memory-content-hash';
import { encodeConversationJson } from '@/server/storage/stored-json';

export const compactedTables = ['agent_memory_candidate', 'agent_memory_job', 'personal_memory_receipt',
  'runtime_knowledge_revision', 'websocket_ticket', 'api_idempotency', 'workflow_event', 'workflow_plan',
  'task_context_state', 'task_context', 'browser_chat_defect', 'schema_migration'] as const;

export class CompactOperationalStorage1794272400000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    const postgres = runner.connection.options.type === 'postgres';
    const parameterQuery = (sql: string, parameters: unknown[]) => {
      let index = 0;
      return runner.query(postgres ? sql.replace(/\?/g, () => `$${++index}`) : sql, parameters);
    };
    await runner.query(`CREATE TABLE memory_operation (
      user_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('candidate','job','receipt')), id TEXT NOT NULL,
      session_id TEXT REFERENCES browser_chat_session(id) ON DELETE CASCADE,
      status TEXT NOT NULL, record_json TEXT NOT NULL DEFAULT '{}', result_json TEXT, error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0), available_at BIGINT NOT NULL DEFAULT 0,
      lease_until BIGINT NOT NULL DEFAULT 0, lease_id TEXT, created_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(user_id,kind,id),
      CHECK ((kind='receipt' AND session_id IS NULL AND status='completed') OR
        (kind='candidate' AND session_id IS NOT NULL AND status IN ('candidate','approved','deleted')) OR
        (kind='job' AND session_id IS NOT NULL AND status IN ('queued','running','completed','failed')))
    )`);
    await runner.query('CREATE INDEX memory_operation_session ON memory_operation(session_id,user_id,kind,status,available_at DESC)');
    await runner.query("CREATE INDEX memory_operation_pending ON memory_operation(status,available_at) WHERE kind='job'");
    await runner.query("CREATE INDEX memory_operation_lease ON memory_operation(user_id,lease_until) WHERE kind='job' AND status='running'");
    await runner.query(`INSERT INTO memory_operation(user_id,kind,id,session_id,status,record_json,result_json,error,attempts,available_at,lease_until,lease_id)
      SELECT user_id,'job',id,session_id,status,CASE WHEN status IN ('completed','failed') THEN '{}' ELSE payload_json END,
      result_json,error,attempts,available_at,lease_until,lease_id FROM agent_memory_job`);
    await runner.query(`INSERT INTO memory_operation(user_id,kind,id,status,created_at)
      SELECT user_id,'receipt',source_key,'completed',created_at FROM personal_memory_receipt`);
    // Hash the expected content instead of retaining another complete memory snapshot.
    let after: string | undefined;
    for (;;) {
      const rows: Array<{ id: string; user_id: string; session_id: string; status: string; record_json: string }> = await parameterQuery(
        `SELECT id,user_id,session_id,status,record_json FROM agent_memory_candidate ${after === undefined ? '' : 'WHERE id > ?'} ORDER BY id LIMIT 16`,
        after === undefined ? [] : [after]);
      if (!rows.length) break;
      for (const row of rows) {
        let record = '{}';
        if (row.status === 'candidate') {
          const data = JSON.parse(row.record_json);
          if (!Array.isArray(data.expectedItems) || !Array.isArray(data.items) || data.userId !== row.user_id || typeof data.sourceKey !== 'string') {
            throw new Error('Invalid pending memory proposal; storage compaction was rolled back.');
          }
          record = JSON.stringify({ userId: data.userId, sourceKey: data.sourceKey,
            expectedContentHash: memoryContentHash(data.expectedItems), items: data.items });
        }
        await parameterQuery("INSERT INTO memory_operation(user_id,kind,id,session_id,status,record_json) VALUES(?, 'candidate', ?, ?, ?, ?)",
          [row.user_id, row.id, row.session_id, row.status, record]);
      }
      after = rows.at(-1)!.id;
    }
    await runner.query(`CREATE TABLE request_record (
      user_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('ticket','idempotency')), scope TEXT NOT NULL, id TEXT NOT NULL,
      token_hash TEXT, session_id TEXT, origin TEXT, request_hash TEXT,
      state TEXT NOT NULL, status_code INTEGER, response_json TEXT,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,kind,scope,id),
      CHECK ((kind='ticket' AND token_hash IS NOT NULL AND state='issued') OR
        (kind='idempotency' AND request_hash IS NOT NULL AND state IN ('pending','completed')))
    )`);
    await runner.query("CREATE UNIQUE INDEX request_record_token ON request_record(token_hash) WHERE kind='ticket'");
    await runner.query('CREATE INDEX request_record_expiry ON request_record(expires_at)');
    await runner.query(`INSERT INTO request_record(user_id,kind,scope,id,token_hash,session_id,origin,state,expires_at,created_at,updated_at)
      SELECT user_id,'ticket',scope,id,token_hash,session_id,origin,'issued',
      expires_at,created_at,created_at FROM websocket_ticket WHERE consumed_at IS NULL`);
    await runner.query(`INSERT INTO request_record(user_id,kind,scope,id,request_hash,state,status_code,response_json,expires_at,created_at,updated_at)
      SELECT user_id,'idempotency',scope,idempotency_key,request_hash,state,status_code,response_json,expires_at,created_at,updated_at FROM api_idempotency`);
    await runner.query(`INSERT INTO runtime_meta(key,value,updated_at)
      SELECT 'knowledge-revision:' || kind || ':' || scope,CAST(revision AS TEXT),CAST(CURRENT_TIMESTAMP AS TEXT) FROM runtime_knowledge_revision`);
    for (const [table, kind] of [['skill', 'skills'], ['personal_memory_item', 'memories']]) {
      if (postgres) {
        await runner.query(`DROP TRIGGER IF EXISTS webpilot_revision_${table} ON ${table}`);
        await runner.query(`DROP FUNCTION IF EXISTS webpilot_revision_${table}()`);
      } else for (const op of ['insert', 'update', 'delete']) await runner.query(`DROP TRIGGER IF EXISTS webpilot_revision_${table}_${op}`);
      const bump = (row: string) => `INSERT INTO runtime_meta(key,value,updated_at)
        VALUES ('knowledge-revision:${kind}:user:' || ${row}.user_id,'1',CAST(CURRENT_TIMESTAMP AS TEXT))
        ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(runtime_meta.value AS BIGINT)+1 AS TEXT),updated_at=excluded.updated_at;
        INSERT INTO runtime_meta(key,value,updated_at)
        SELECT 'knowledge-revision:${kind}:shared','1',CAST(CURRENT_TIMESTAMP AS TEXT) WHERE ${row}.shared=${postgres ? 'true' : '1'}
        ON CONFLICT(key) DO UPDATE SET value=CAST(CAST(runtime_meta.value AS BIGINT)+1 AS TEXT),updated_at=excluded.updated_at;`;
      if (postgres) {
        await runner.query(`CREATE FUNCTION orbit_revision_${table}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF TG_OP <> 'INSERT' THEN ${bump('OLD')} END IF;
          IF TG_OP <> 'DELETE' THEN ${bump('NEW')} END IF; RETURN NULL; END $$`);
        await runner.query(`CREATE TRIGGER orbit_revision_${table} AFTER INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION orbit_revision_${table}()`);
      } else for (const op of ['INSERT', 'UPDATE', 'DELETE']) await runner.query(`CREATE TRIGGER orbit_revision_${table}_${op.toLowerCase()}
        AFTER ${op} ON ${table} BEGIN ${op !== 'INSERT' ? bump('OLD') : ''} ${op !== 'DELETE' ? bump('NEW') : ''} END`);
    }
    // Recovery uses the current durable state and the context header; these were write-only duplicates.
    await runner.query("DELETE FROM execution_record WHERE kind IN ('event','compaction')");
    for (const table of compactedTables) await runner.query(`DROP TABLE IF EXISTS ${table}`);
    await runner.query(`ALTER TABLE conversation_record ADD COLUMN record_gzip ${postgres ? 'BYTEA' : 'BLOB'}`);
    // Read one payload at a time: large historical logs must not all enter the migration process heap.
    const payloadBytes = postgres ? 'octet_length(record_json)' : 'length(CAST(record_json AS BLOB))';
    let cursor: [string, string, string] | undefined;
    for (;;) {
      const keys: Array<{ session_id: string; kind: 'log' | 'context' | 'request'; id: string }> = await parameterQuery(
        `SELECT session_id,kind,id FROM conversation_record WHERE kind IN ('log','context','request')
        AND ${payloadBytes} >= 16384 ${cursor ? 'AND (session_id,kind,id) > (?, ?, ?)' : ''}
        ORDER BY session_id,kind,id LIMIT 16`, cursor || []);
      if (!keys.length) break;
      for (const key of keys) {
        const parameters = [key.session_id, key.kind, key.id];
        const [row] = await parameterQuery('SELECT record_json FROM conversation_record WHERE session_id=? AND kind=? AND id=?', parameters);
        const stored = encodeConversationJson(key.kind, row.record_json);
        if (stored.record_gzip) await parameterQuery('UPDATE conversation_record SET record_json=?,record_gzip=? WHERE session_id=? AND kind=? AND id=?',
          [stored.record_json, stored.record_gzip, ...parameters]);
      }
      const last = keys.at(-1)!;
      cursor = [last.session_id, last.kind, last.id];
    }
  }

  async down(): Promise<void> {
    throw new Error('Operational storage compaction is one-way. Restore a database backup to revert it.');
  }
}

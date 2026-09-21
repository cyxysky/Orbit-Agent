import { randomUUID } from 'node:crypto';
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HybridRuntime1790000200000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query('CREATE TABLE agent_runtime_state (session_id TEXT NOT NULL REFERENCES browser_chat_session(id) ON DELETE CASCADE, scope_id TEXT NOT NULL, revision INTEGER NOT NULL, record_json TEXT NOT NULL, PRIMARY KEY(session_id, scope_id))');
    await runner.query('CREATE TABLE agent_runtime_event (session_id TEXT NOT NULL REFERENCES browser_chat_session(id) ON DELETE CASCADE, scope_id TEXT NOT NULL, revision INTEGER NOT NULL, event_json TEXT NOT NULL, PRIMARY KEY(session_id, scope_id, revision))');
    await runner.query('CREATE TABLE agent_runtime_call (session_id TEXT NOT NULL REFERENCES browser_chat_session(id) ON DELETE CASCADE, scope_id TEXT NOT NULL, call_id TEXT NOT NULL, PRIMARY KEY(session_id, scope_id, call_id))');
    await runner.query('CREATE TABLE agent_runtime_compaction (session_id TEXT NOT NULL REFERENCES browser_chat_session(id) ON DELETE CASCADE, scope_id TEXT NOT NULL, epoch INTEGER NOT NULL, snapshot_json TEXT NOT NULL, PRIMARY KEY(session_id, scope_id, epoch))');
    await runner.query("CREATE TABLE agent_memory_candidate (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_id TEXT NOT NULL REFERENCES browser_chat_session(id) ON DELETE CASCADE, source_key TEXT NOT NULL, status TEXT NOT NULL, record_json TEXT NOT NULL, UNIQUE(user_id, source_key))");
    await runner.query("CREATE TABLE agent_memory_job (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_id TEXT NOT NULL REFERENCES browser_chat_session(id) ON DELETE CASCADE, status TEXT NOT NULL, attempts INTEGER NOT NULL, available_at BIGINT NOT NULL, lease_until BIGINT NOT NULL, lease_id TEXT, payload_json TEXT NOT NULL, error TEXT)");
    // Convert only the saved projection. Never rebuild active from the event/archive log.
    const rows: Array<{ id: string; snapshot_json: string }> = await runner.query('SELECT id, snapshot_json FROM browser_chat_session');
    for (const row of rows) {
      const snapshot = JSON.parse(row.snapshot_json), context = snapshot.modelContext;
      if (!context) continue;
      const archived = context.records || Object.fromEntries((await runner.query(runner.connection.options.type === 'postgres'
        ? 'SELECT id, record_json FROM browser_chat_context_record WHERE session_id = $1'
        : 'SELECT id, record_json FROM browser_chat_context_record WHERE session_id = ?', [row.id])).map((record: { id: string; record_json: string }) => [record.id, JSON.parse(record.record_json)]));
      for (const [scopeId, view] of Object.entries({ main: context, ...context.branches }) as Array<[string, Record<string, unknown>]>) {
        let old: { segments?: Array<{ ref: string }> } = {};
        try { old = JSON.parse(String(view.continuationSummary || '{}')); } catch { /* Original archive remains untouched. */ }
        const active = Array.isArray(view.active) ? view.active : [];
        // Existing segment records remain historical evidence in order, eligible for rolling compaction.
        view.active = [...(old.segments || []).map(segment => segment.ref).filter(ref => !active.includes(ref)), ...active];
        // Quarantine an unresolved old active exchange; it is evidence, not a replayable decision.
        const messages = (view.active as string[]).map(ref => archived[ref]).filter(Boolean);
        const results = new Map<string, Record<string, unknown>>();
        for (const message of messages) if (message.role === 'tool' && Array.isArray(message.content)) {
          for (const part of message.content) if (part.type === 'tool-result') results.set(part.toolCallId, part.output?.value || {});
        }
        const seenCallIds = new Set<string>();
        for (const ref of [...((view.history || []) as string[]), ...(view.active as string[])]) {
          const message = archived[ref];
          if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue;
          for (const part of message.content) if (part.type === 'tool-call' && !seenCallIds.has(part.toolCallId)) {
            seenCallIds.add(part.toolCallId);
            await runner.query(runner.connection.options.type === 'postgres'
              ? 'INSERT INTO agent_runtime_call (session_id, scope_id, call_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING'
              : 'INSERT INTO agent_runtime_call (session_id, scope_id, call_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', [row.id, scopeId, part.toolCallId]);
          }
        }
        const pendingMessages = messages.filter(message => message.role === 'assistant' && Array.isArray(message.content)).flatMap(message => {
          const content = message.content.filter((part: { type: string; toolCallId: string }) => part.type === 'tool-call'
            && (!results.has(part.toolCallId) || results.get(part.toolCallId)?.code === 'interrupted-tool-outcome'));
          return content.length ? [{ ...message, content }] : [];
        });
        if (pendingMessages.length) {
          const state = { revision: 1, pending: { id: randomUUID(), phase: 'uncertain', messages: pendingMessages,
            calls: pendingMessages.flatMap(message => message.content.map((part: { toolCallId: string; toolName: string; input: unknown }) => ({ toolCallId: part.toolCallId, toolName: part.toolName, input: part.input }))), results: [] } };
          await runner.query(runner.connection.options.type === 'postgres'
            ? 'INSERT INTO agent_runtime_state (session_id, scope_id, revision, record_json) VALUES ($1, $2, $3, $4)'
            : 'INSERT INTO agent_runtime_state (session_id, scope_id, revision, record_json) VALUES (?, ?, ?, ?)', [row.id, scopeId, 1, JSON.stringify(state)]);
          await runner.query(runner.connection.options.type === 'postgres'
            ? 'INSERT INTO agent_runtime_event (session_id, scope_id, revision, event_json) VALUES ($1, $2, $3, $4)'
            : 'INSERT INTO agent_runtime_event (session_id, scope_id, revision, event_json) VALUES (?, ?, ?, ?)', [row.id, scopeId, 1, JSON.stringify({ event: 'migration_unresolved_exchange', pending: state.pending })]);
        }
        view.continuationSummary = JSON.stringify({ version: 3, epoch: 0 });
        delete view.lastCompression; delete view.backgroundRef; delete view.lastRequest;
      }
      await runner.query(runner.connection.options.type === 'postgres' ? 'UPDATE browser_chat_session SET snapshot_json = $1 WHERE id = $2' : 'UPDATE browser_chat_session SET snapshot_json = ? WHERE id = ?', [JSON.stringify(snapshot), row.id]);
    }
  }
  async down(runner: QueryRunner) { await runner.query('DROP TABLE agent_memory_job'); await runner.query('DROP TABLE agent_memory_candidate'); await runner.query('DROP TABLE agent_runtime_compaction'); await runner.query('DROP TABLE agent_runtime_call'); await runner.query('DROP TABLE agent_runtime_event'); await runner.query('DROP TABLE agent_runtime_state'); }
}

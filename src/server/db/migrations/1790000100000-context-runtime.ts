import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ContextRuntime1790000100000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query('CREATE TABLE task_context_state (session_id TEXT NOT NULL REFERENCES browser_chat_session(id) ON DELETE CASCADE, scope_id TEXT NOT NULL, revision INTEGER NOT NULL, record_json TEXT NOT NULL, PRIMARY KEY(session_id, scope_id))');
    const postgres = runner.connection.options.type === 'postgres';
    const notes: Array<{ session_id: string; entry_key: string; record_json: string }> = await runner.query('SELECT session_id, entry_key, record_json FROM task_context');
    for (const row of notes) {
      const entry = { ...JSON.parse(row.record_json), taskId: 'initial', scopeId: 'main', kind: 'note', verified: false };
      await runner.query(postgres ? 'UPDATE task_context SET record_json = $1, entry_key = $4 WHERE session_id = $2 AND entry_key = $3'
        : 'UPDATE task_context SET record_json = ?, entry_key = ? WHERE session_id = ? AND entry_key = ?', postgres ? [JSON.stringify(entry), row.session_id, row.entry_key, `main:initial:${row.entry_key}`] : [JSON.stringify(entry), `main:initial:${row.entry_key}`, row.session_id, row.entry_key]);
    }
  }
  async down(runner: QueryRunner) { await runner.query('DROP TABLE task_context_state'); }
}

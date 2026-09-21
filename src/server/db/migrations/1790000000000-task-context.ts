import type { MigrationInterface, QueryRunner } from 'typeorm';
export class TaskContext1790000000000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query('CREATE TABLE task_context (session_id TEXT NOT NULL REFERENCES browser_chat_session(id) ON DELETE CASCADE, entry_key TEXT NOT NULL, record_json TEXT NOT NULL, PRIMARY KEY (session_id, entry_key))');
    const rows: Array<{session_id: string; record_json: string}> = await runner.query('SELECT session_id, record_json FROM workflow_plan');
    for (const row of rows) {
      const plan = JSON.parse(row.record_json);
      for (const note of plan.notes || []) {
        const entry = { ...note, updatedAt: plan.updatedAt };
        const sql = runner.connection.options.type === 'postgres'
          ? 'INSERT INTO task_context (session_id, entry_key, record_json) VALUES ($1, $2, $3)'
          : 'INSERT INTO task_context (session_id, entry_key, record_json) VALUES (?, ?, ?)';
        await runner.query(sql, [row.session_id, note.key, JSON.stringify(entry)]);
      }
      if ('notes' in plan) {
        delete plan.notes;
        const sql = runner.connection.options.type === 'postgres'
          ? 'UPDATE workflow_plan SET record_json = $1 WHERE session_id = $2'
          : 'UPDATE workflow_plan SET record_json = ? WHERE session_id = ?';
        await runner.query(sql, [JSON.stringify(plan), row.session_id]);
      }
    }
  }
  async down(runner: QueryRunner) { await runner.query('DROP TABLE task_context'); }
}

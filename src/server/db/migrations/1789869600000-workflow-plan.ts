import type { MigrationInterface, QueryRunner } from 'typeorm';
export class WorkflowPlan1789869600000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query('CREATE TABLE workflow_plan (session_id TEXT PRIMARY KEY REFERENCES browser_chat_session(id) ON DELETE CASCADE, revision INTEGER NOT NULL, record_json TEXT NOT NULL)');
    await runner.query('CREATE TABLE workflow_event (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES browser_chat_session(id) ON DELETE CASCADE, revision INTEGER NOT NULL, record_json TEXT NOT NULL)');
    await runner.query('CREATE INDEX workflow_event_session ON workflow_event(session_id, revision)');
  }
  async down(runner: QueryRunner) {
    await runner.query('DROP TABLE workflow_event');
    await runner.query('DROP TABLE workflow_plan');
  }
}

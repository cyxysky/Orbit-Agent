import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CommunicationConversations1788832800000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(`CREATE TABLE communication_conversation (
      id TEXT PRIMARY KEY, integration_id TEXT NOT NULL, bot_id TEXT NOT NULL, user_id TEXT NOT NULL,
      record_json TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    await runner.query(`CREATE TABLE communication_inbound (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, status TEXT NOT NULL,
      record_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    await runner.query('CREATE INDEX communication_inbound_pending ON communication_inbound(status, created_at)');
  }
  async down(runner: QueryRunner) {
    await runner.query('DROP TABLE communication_inbound');
    await runner.query('DROP TABLE communication_conversation');
  }
}

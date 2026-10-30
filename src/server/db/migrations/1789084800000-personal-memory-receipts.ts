import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PersonalMemoryReceipts1789084800000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(`CREATE TABLE personal_memory_receipt (
      user_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      report_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, source_key)
    )`);
  }

  async down(runner: QueryRunner) {
    await runner.query('DROP TABLE personal_memory_receipt');
  }
}

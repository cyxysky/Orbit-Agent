import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MemoryJobResults1790600000000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query('ALTER TABLE agent_memory_job ADD COLUMN result_json TEXT');
    await runner.query('CREATE INDEX agent_memory_job_pending ON agent_memory_job (status, available_at)');
  }
  async down(runner: QueryRunner) {
    await runner.query('DROP INDEX agent_memory_job_pending');
    await runner.query('ALTER TABLE agent_memory_job DROP COLUMN result_json');
  }
}

import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Application identity metadata is separate from per-user resources. */
export class UserCookieIdentity1793923200000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(`CREATE TABLE application_user (
      id TEXT PRIMARY KEY,
      cookie TEXT,
      cookie_domain TEXT,
      cookie_fingerprint TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    await runner.query('CREATE UNIQUE INDEX application_user_cookie_identity ON application_user(cookie_domain, cookie_fingerprint) WHERE cookie_fingerprint IS NOT NULL');
  }
  async down(runner: QueryRunner) { await runner.query('DROP TABLE application_user'); }
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { applicationMigrations } from '../src/server/db/migrations/index.ts';

// Execute the current migration DDL against an empty-schema recorder, without a database connection.
const statements = ['BEGIN', 'CREATE TABLE typeorm_migration ("id" SERIAL PRIMARY KEY, "timestamp" BIGINT NOT NULL, "name" VARCHAR NOT NULL)'];
const tables = new Map();
const identifier = value => '"' + String(value).replaceAll('"', '""') + '"';
const runner = {
  connection: { options: { type: 'postgres' } },
  async query(sql, parameters = []) {
    if (parameters.length) throw new Error('Empty-database migrations must not require data parameters.');
    if (/^\s*SELECT\b/i.test(sql)) return [];
    const table = /^\s*CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)/i.exec(sql)?.[1];
    if (table) {
      const foreignKeys = [...sql.matchAll(/(\w+)\s+TEXT\s+NOT NULL\s+REFERENCES\s+(\w+)\((\w+)\)/gi)].map(match => ({
        name: `${table}_${match[1]}_fkey`, columnNames: [match[1]], referencedTableName: match[2], referencedColumnNames: [match[3]],
      }));
      tables.set(table, { name: table, foreignKeys });
    }
    statements.push(sql.trim().replace(/;\s*$/, ''));
    return [];
  },
  async getTable(name) {
    const table = tables.get(name);
    if (!table) throw new Error(`Unknown migration table: ${name}`);
    return table;
  },
  async dropForeignKey(table, key) {
    statements.push(`ALTER TABLE ${identifier(table.name)} DROP CONSTRAINT ${identifier(key.name)}`);
    table.foreignKeys = table.foreignKeys.filter(item => item !== key);
  },
  async createForeignKey(name, key) {
    const constraint = key.name || `${name}_${key.columnNames.join('_')}_fkey`;
    statements.push(`ALTER TABLE ${identifier(name)} ADD CONSTRAINT ${identifier(constraint)} FOREIGN KEY (${key.columnNames.map(identifier).join(', ')}) REFERENCES ${identifier(key.referencedTableName)} (${key.referencedColumnNames.map(identifier).join(', ')})${key.onDelete ? ` ON DELETE ${key.onDelete}` : ''}`);
    tables.get(name).foreignKeys.push({ ...key, name: constraint });
  },
};
for (const Migration of applicationMigrations) {
  const migration = new Migration(), name = migration.name || Migration.name;
  const timestamp = /\d{13}$/.exec(name)?.[0];
  if (!timestamp) throw new Error(`Invalid migration name: ${name}`);
  statements.push(`-- ${name}`);
  await migration.up(runner);
  statements.push(`INSERT INTO typeorm_migration("timestamp", "name") VALUES (${timestamp}, '${name.replaceAll("'", "''")}')`);
}
statements.push('COMMIT');
const output = path.resolve('sql/postgresql-init.sql');
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, '-- Generated from applicationMigrations. For a new empty PostgreSQL database.\n-- Regenerate: npm run db:postgres:init-sql\n\n' + statements.map(sql => sql.startsWith('--') ? sql : `${sql};`).join('\n\n') + '\n', 'utf8');
console.log(`Exported ${tables.size} tables and ${applicationMigrations.length} migrations to ${path.relative(process.cwd(), output)}.`);

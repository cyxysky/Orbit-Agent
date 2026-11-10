import fs from 'node:fs/promises';
import path from 'node:path';
import { applicationMigrations } from '../src/server/db/migrations/index.ts';
import { consolidatedTables } from '../src/server/db/migrations/1794268800000-consolidated-records.ts';
import { compactedTables } from '../src/server/db/migrations/1794272400000-compact-operational-storage.ts';

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
    const dropped = /^\s*DROP TABLE(?: IF EXISTS)?\s+(\w+)/i.exec(sql)?.[1];
    if (dropped) tables.delete(dropped);
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
// Historical data-copy statements are unnecessary on an empty database. Keep only the current physical schema.
const retired = new RegExp(`\\b(?:${[...consolidatedTables, ...compactedTables].join('|')})\\b`, 'i');
// A retired function can be referenced by a trigger on a retained table.
// Track function lifetimes so the empty schema never creates a dangling trigger.
const activeFunctions = new Map();
for (const [index, sql] of statements.entries()) {
  const created = /^CREATE(?: OR REPLACE)? FUNCTION\s+(\w+)/i.exec(sql)?.[1];
  const dropped = /^DROP FUNCTION(?: IF EXISTS)?\s+(\w+)/i.exec(sql)?.[1];
  if (created) activeFunctions.set(created, index);
  if (dropped) activeFunctions.delete(dropped);
}
const current = statements.filter((sql, index) => {
  if (retired.test(sql)) return false;
  const created = /^CREATE(?: OR REPLACE)? FUNCTION\s+(\w+)/i.exec(sql)?.[1];
  if (created && activeFunctions.get(created) !== index) return false;
  const dependency = /^CREATE TRIGGER\b[\s\S]*EXECUTE FUNCTION\s+(\w+)/i.exec(sql)?.[1];
  return !dependency || activeFunctions.has(dependency);
});
await fs.writeFile(output, '-- Generated from applicationMigrations. For a new empty PostgreSQL database.\n-- Regenerate: npm run db:postgres:init-sql\n\n' + current.map(sql => sql.startsWith('--') ? sql : `${sql};`).join('\n\n') + '\n', 'utf8');
console.log(`Exported ${tables.size} tables and ${applicationMigrations.length} migrations to ${path.relative(process.cwd(), output)}.`);

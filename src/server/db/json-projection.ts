import { databaseDriver } from './database';

/** Keep large SQLite JSON bodies out of the API heap when only metadata is read. */
export function projectDatabaseJsonFields(column: string, fields: string[]) {
  if (!/^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?$/i.test(column)
    || fields.some(field => !/^[a-z_][a-z0-9_]*$/i.test(field))) throw new Error('Invalid JSON projection identifier.');
  if (databaseDriver() !== 'sqlite') return column;
  return `CASE WHEN json_valid(${column}) THEN json_object(${fields.map(field => `'${field}', json(${column} -> '$.${field}')`).join(', ')}) ELSE '{}' END`;
}

import { workspaceEntities } from './record-sources';
import { databaseDriver, executeDatabase, type DatabaseExecutor } from '@/server/db/database';

export function runtimeOwnerStatement(id: string) {
  return { sql: `INSERT INTO workspace_entity (kind,id) VALUES ('runtime',?) ON CONFLICT(kind,id) DO NOTHING`, params: [id] };
}

export async function ensureRuntimeOwner(id: string, executor: DatabaseExecutor) {
  const statement = runtimeOwnerStatement(id);
  await executeDatabase(statement.sql, statement.params, executor);
}

/** Serialize bounded per-execution collections before reading their count/revision. */
export async function lockRuntimeOwner(id: string, executor: DatabaseExecutor) {
  await ensureRuntimeOwner(id, executor);
  if (databaseDriver() === 'postgres') await executeDatabase(`SELECT id FROM ${workspaceEntities('runtime')} WHERE id = ? FOR UPDATE`, [id], executor);
}

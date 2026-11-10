import { databaseDriver, executeDatabase, type DatabaseExecutor } from '@/server/db/database';

export function runtimeOwnerStatement(id: string) {
  return { sql: 'INSERT INTO agent_runtime_owner (id) VALUES (?) ON CONFLICT (id) DO NOTHING', params: [id] };
}

export async function ensureRuntimeOwner(id: string, executor: DatabaseExecutor) {
  const statement = runtimeOwnerStatement(id);
  await executeDatabase(statement.sql, statement.params, executor);
}

/** Serialize bounded per-execution collections before reading their count/revision. */
export async function lockRuntimeOwner(id: string, executor: DatabaseExecutor) {
  await ensureRuntimeOwner(id, executor);
  if (databaseDriver() === 'postgres') await executeDatabase('SELECT id FROM agent_runtime_owner WHERE id = ? FOR UPDATE', [id], executor);
}

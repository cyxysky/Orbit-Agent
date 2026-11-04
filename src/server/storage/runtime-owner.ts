import { executeDatabase, type DatabaseExecutor } from '@/server/db/database';

export function runtimeOwnerStatement(id: string) {
  return { sql: 'INSERT INTO agent_runtime_owner (id) VALUES (?) ON CONFLICT (id) DO NOTHING', params: [id] };
}

export async function ensureRuntimeOwner(id: string, executor: DatabaseExecutor) {
  const statement = runtimeOwnerStatement(id);
  await executeDatabase(statement.sql, statement.params, executor);
}

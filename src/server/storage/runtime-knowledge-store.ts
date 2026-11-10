import { knowledgeRecords } from './record-sources';
import { databaseDriver, parseDatabaseJson, queryDatabase } from '@/server/db/database';
import type { SkillRecord } from '@/server/ai/schemas/runtime.schema';

/** Small metadata reads detect committed changes, including other server processes. */
export async function readRuntimeKnowledgeRevisions(userId: string, domain: string) {
  const scopes = ['shared', `user:${userId}`];
  const keys = ['skills', 'memories'].flatMap(kind => scopes.map(scope => `knowledge-revision:${kind}:${scope}`));
  const rows = await queryDatabase<{ key: string; value: string }>(
    'SELECT key,value FROM runtime_meta WHERE key IN (?, ?, ?, ?)', keys);
  const values = new Map(rows.map(row => [row.key, row.value]));
  const revision = (kind: string) => JSON.stringify([domain, ...scopes.map(scope => [scope, values.get(`knowledge-revision:${kind}:${scope}`) || '0'])]);
  return { skills: revision('skills'), memories: revision('memories') };
}

/** Catalog reads never transfer Skill bodies from the database. */
export async function readRuntimeSkillCatalog(userId: string): Promise<SkillRecord[]> {
  const field = (key: string) => databaseDriver() === 'postgres'
    ? `(CAST(record_json AS jsonb)->>'${key}')` : `json_extract(record_json, '$.${key}')`;
  const rows = await queryDatabase<{
    id: string; user_id: string; shared: boolean | number; title: string; status: SkillRecord['status'];
    created_at: string; updated_at: string; description: string; triggers: string; version: string | number;
  }>(`SELECT id, user_id, shared, title, status, created_at, updated_at,
    ${field('description')} AS description, ${field('triggerPhrases')} AS triggers, ${field('version')} AS version
    FROM ${knowledgeRecords('skill')} WHERE (user_id = ? OR shared = ?) AND status = 'ready' ORDER BY id`, [userId, true]);
  return rows.map((row) => ({
    id: row.id, userId: row.user_id, shared: Boolean(row.shared), title: row.title,
    status: row.status, description: row.description || '', triggerPhrases: parseDatabaseJson<string[]>(row.triggers, []),
    version: Number(row.version) || 1, createdAt: row.created_at, updatedAt: row.updated_at, content: { details: '' },
  }));
}

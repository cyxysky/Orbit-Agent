import { databaseDriver, queryDatabase, queryDatabaseOne } from '@/server/db/database';
import { browserChatArtifactOpenUrl, mergeBrowserChatArtifactSummaries,
  type BrowserChatArtifactSummary, type BrowserChatMessageFileGroup } from '@/lib/browser-chat-artifacts';

/** Include every output message in this conversation, independently of loaded history pages. */
export async function readBrowserChatMessageFileGroups(sessionId: string, userId: string): Promise<BrowserChatMessageFileGroup[] | undefined> {
  const session = await queryDatabaseOne<{ id: string }>(
    'SELECT id FROM browser_chat_session WHERE id = ? AND user_id = ?', [sessionId, userId],
  );
  if (!session) return undefined;
  const field = (key: string) => databaseDriver() === 'postgres'
    ? `CAST(m.record_json AS jsonb)->>'${key}'` : `json_extract(m.record_json, '$.${key}')`;
  const rows = await queryDatabase<{
    id: string; role: string; content: string | null; created_at: string; record_json: string | null;
  }>(`SELECT m.id, ${field('role')} AS role, SUBSTR(${field('content')}, 1, 320) AS content,
      COALESCE(${field('createdAt')}, m.time) AS created_at, f.record_json
      FROM browser_chat_message m JOIN browser_chat_session s ON s.id = m.session_id
      LEFT JOIN browser_chat_file_message f ON f.session_id = m.session_id AND f.id = m.id
      WHERE m.session_id = ? AND s.user_id = ?
        AND (${field('role')} = 'user' OR f.id IS NOT NULL)
      ORDER BY created_at ASC, CASE WHEN ${field('role')} = 'user' THEN 0 ELSE 1 END, m.id ASC`, [sessionId, userId]);
  const groups: BrowserChatMessageFileGroup[] = [];
  let prompt = '';
  for (const row of rows) {
    if (row.role === 'user') prompt = (row.content || '').trim().replace(/\s+/g, ' ').slice(0, 160);
    if (!row.record_json) continue;
    const message = JSON.parse(row.record_json) as { artifacts?: BrowserChatArtifactSummary[] };
    // Deduplicate within a message; the same file may legitimately appear in another message.
    const files = mergeBrowserChatArtifactSummaries(message.artifacts)
      .filter(artifact => artifact.kind !== 'screenshot' && browserChatArtifactOpenUrl(artifact));
    if (files.length) groups.push({
      messageId: row.id,
      title: prompt || (row.content || '').trim().replace(/\s+/g, ' ').slice(0, 160) || files[0].title || files[0].fileName,
      createdAt: row.created_at,
      files,
    });
  }
  return groups.reverse();
}

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createTextDocumentStore } from '@cjfclonedeep/capability-sdk/text-editor/node';
import type { TextDocument } from '@cjfclonedeep/capability-sdk/text-editor';
import { normalizeApplicationUserId } from '@/server/auth/user-context';
import { appDataRoot } from '@/server/storage/paths';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';


function textOwner(userId?: string) {
  const id = normalizeApplicationUserId(userId);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id)) throw new CodedError(ERROR_CODES.APPLICATION_ERROR, 'Invalid text document owner.');
  return id;
}
export function textUserDirectory(userId?: string) { return path.join(appDataRoot(), 'text-documents', textOwner(userId)); }
function importedId(value: string) {
  const hash = createHash('sha256').update(value).digest('hex').slice(0, 32);
  return `text_${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
}
/** Import old prose as ordinary Markdown documents once; never write or delete the old database. */
export function importLegacyTextDocuments(store: ReturnType<typeof createTextDocumentStore>, userId?: string) {
  const db = store.database();
  if (db.prepare("SELECT 1 FROM store_meta WHERE key='prose-imported'").get()) return;
  const filename = path.join(appDataRoot(), 'novels', textOwner(userId), 'novels.db');
  const documents: TextDocument[] = [];
  if (existsSync(filename)) {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
    const legacy = new DatabaseSync(filename, { readOnly: true });
    try {
      for (const row of legacy.prepare('SELECT id, record_json FROM records ORDER BY updated_at').iterate()) {
        const record = JSON.parse(String(row.record_json)) as { id: string; plan: Record<string, unknown> & { title: string }; chapters: { number: number; title: string; content: string }[]; createdAt: string; updatedAt: string };
        const title = String(record.plan.title || '导入文档'), now = new Date().toISOString();
        const metadata = { format: 'markdown' as const, createdAt: record.createdAt || now, updatedAt: record.updatedAt || now };
        if (record.chapters.length) documents.push({ ...metadata, id: importedId(`${row.id}:content`), title,
          content: [`# ${title}`, ...record.chapters.map(chapter => `## 第 ${chapter.number} 章 ${chapter.title}\n\n${chapter.content}`)].join('\n\n') });
        documents.push({ ...metadata, id: importedId(`${row.id}:notes`), title: `${title} · 创作笔记`,
          content: `# ${title} · 创作笔记\n\n\`\`\`json\n${JSON.stringify(record.plan, null, 2)}\n\`\`\`` });
      }
    } finally { legacy.close(); }
  }
  store.transaction(() => {
    if (db.prepare("SELECT 1 FROM store_meta WHERE key='prose-imported'").get()) return;
    for (const document of documents) if (!store.get(document.id)) store.save(document);
    db.prepare("INSERT INTO store_meta VALUES ('prose-imported', '1')").run();
  });
}
export function createUserTextDocumentStore(userId?: string) {
  const store = createTextDocumentStore(textUserDirectory(userId));
  try { importLegacyTextDocuments(store, userId); return store; }
  catch (error) { void store.dispose(); throw error; }
}

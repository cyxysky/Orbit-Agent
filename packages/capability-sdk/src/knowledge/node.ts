import { createHash } from 'node:crypto';
import { createCapabilityDocumentDatabase } from '../node.ts';
import { createKnowledgeCapability, type KnowledgeStore } from './index.ts';
import type { CapabilityRunContext } from '../index.ts';
import type { KnowledgeDocument, KnowledgeDocumentSummary, KnowledgeSearchHit, KnowledgeFilter, KnowledgePackage, KnowledgePackageSummary } from './types.ts';
import { parseKnowledgePackageArchive } from './package.ts';

function normalized(value: string) { return value.normalize('NFKC').toLowerCase(); }
function aliases(document: KnowledgeDocument, chapterOnly = false): string[] {
  return [...new Set((chapterOnly ? [document.metadata?.chapter_aliases] : [document.metadata?.aliases, document.metadata?.chapter_aliases])
    .flatMap(value => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length <= 100) : [])
    .slice(0, 200).map(value => normalized(value).trim()).filter(Boolean))];
}
function matchedAliases(query: string, values: string[]) {
  return values.map(normalized).filter(alias => {
    let offset = query.indexOf(alias);
    while (offset >= 0) {
      if (!/^[a-z0-9_]+$/.test(alias) || (!/[a-z0-9_]/.test(query[offset - 1] || '') && !/[a-z0-9_]/.test(query[offset + alias.length] || ''))) return true;
      offset = query.indexOf(alias, offset + 1);
    }
    return false;
  });
}
function excerpt(content: string, words: string[], size: number) {
  // Find the passage covering the most query terms, including passages late in long documents.
  const lower = content.toLowerCase(), starts = new Set([0]);
  for (const word of words) {
    let position = lower.indexOf(word);
    for (let count = 0; position >= 0 && count < 8; count++, position = lower.indexOf(word, position + Math.max(1, word.length))) starts.add(Math.max(0, position - 60));
    const last = lower.lastIndexOf(word);
    if (last >= 0) starts.add(Math.max(0, last - 60));
  }
  let start = 0, coverage = -1;
  for (const candidate of starts) {
    const window = lower.slice(candidate, candidate + size), score = words.filter(word => window.includes(word)).length;
    if (score > coverage) { start = candidate; coverage = score; }
  }
  if (start && /[\uDC00-\uDFFF]/.test(content[start])) start--;
  let end = Math.min(content.length, start + size);
  if (end < content.length && /[\uD800-\uDBFF]/.test(content[end - 1])) end--;
  return { start, text: content.slice(start, end), coverage: Math.max(0, coverage) };
}

function tokens(value: string, indexing = false): string[] {
  const words = (normalized(value).match(/[\p{L}\p{N}_./:-]+/gu) || [])
    .flatMap(word => word.split(/(\p{Script=Han}+)/u).filter(Boolean))
    .flatMap(word => /\p{Script=Han}/u.test(word) ? [word] : [...new Set([word, ...word.split(/[_.:/-]+/).filter(Boolean)])]);
  const terms = words.flatMap(word => {
    if (!/\p{Script=Han}/u.test(word)) return [word];
    const chars = [...word], pairs = chars.slice(1).map((character, i) => chars[i] + character);
    return indexing || chars.length === 1 ? [...chars, ...pairs] : pairs;
  });
  return indexing ? terms : [...new Set(terms)];
}
function summary(document: KnowledgeDocument): KnowledgeDocumentSummary {
  return { id: document.id, title: document.title, source: document.source, contentChars: document.content.length,
    packageId: document.packageId, packageVersion: document.packageVersion, recordId: document.recordId,
    kind: document.kind, domain: document.domain, chapterId: document.chapterId, chapterTitle: document.chapterTitle,
    answerEligible: document.answerEligible, createdAt: document.createdAt, updatedAt: document.updatedAt };
}
function packageSummary(pack: KnowledgePackage): KnowledgePackageSummary {
  return { id: pack.id, name: pack.name, version: pack.version, description: pack.description, enabled: pack.enabled,
    recordCount: pack.recordCount, domains: pack.domains, importedAt: pack.importedAt, checksum: pack.checksum };
}

export function createFileKnowledgeStore(input: { directory: string }): KnowledgeStore {
  const store = createCapabilityDocumentDatabase<KnowledgeDocument>({
    directory: input.directory, filename: 'knowledge.db', legacyFilename: 'knowledge.json',
    readLegacy(value) {
      const file = value as { version?: number; documents?: KnowledgeDocument[] };
      if (file.version !== 1 || !Array.isArray(file.documents)) throw new Error('Invalid knowledge store.');
      return file.documents;
    },
  });
  let initialized = false;
  let preparing: Promise<void> | undefined;
  function index(document: KnowledgeDocument) {
    const db = store.database();
    db.prepare('DELETE FROM knowledge_records WHERE document_id=?').run(document.id);
    db.prepare('DELETE FROM knowledge_substrings WHERE document_id=?').run(document.id);
    const title = [document.recordId || document.id, document.chapterTitle, document.title, ...aliases(document)].filter(Boolean).join(' ');
    db.prepare('INSERT INTO knowledge_records VALUES (?, ?, ?)').run(document.id,
      tokens(title, true).join(' '), tokens(document.content, true).join(' '));
    db.prepare('INSERT INTO knowledge_substrings VALUES (?, ?)').run(document.id, normalized(title + '\n' + document.content));
  }
  function database() {
    const db = store.database();
    if (!initialized) {
      db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_records USING fts5(document_id UNINDEXED, title, body);" +
        "CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_substrings USING fts5(document_id UNINDEXED, text, tokenize='trigram');" +
        "CREATE TABLE IF NOT EXISTS knowledge_packages (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL, record_json TEXT NOT NULL);" +
        "CREATE TABLE IF NOT EXISTS knowledge_archives (id TEXT PRIMARY KEY, filename TEXT NOT NULL, content BLOB NOT NULL);" +
        "CREATE TABLE IF NOT EXISTS knowledge_package_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
      store.transaction(() => {
        if (!db.prepare("SELECT 1 FROM knowledge_package_meta WHERE key='record-index-v2'").get()) {
          db.exec('DELETE FROM knowledge_records; DELETE FROM knowledge_substrings;');
          for (const row of db.prepare('SELECT record_json FROM records').iterate()) index(JSON.parse(String(row.record_json)));
          db.prepare("INSERT INTO knowledge_package_meta VALUES ('record-index-v2', '1')").run();
        }
      });
      initialized = true;
    }
    return db;
  }
  async function prepare() {
    const db = database();
    preparing ||= (async () => {
      // Routing aliases are derived from the saved original package, just like the full-text index.
      const pending = db.prepare("SELECT a.id FROM knowledge_archives a JOIN knowledge_packages p ON p.id=a.id LEFT JOIN knowledge_package_meta m ON m.key='routing-source:'||a.id WHERE m.value IS NULL OR m.value<>json_extract(p.record_json,'$.checksum')").all();
      for (const item of pending) {
        const archive = db.prepare('SELECT filename,content FROM knowledge_archives WHERE id=?').get(item.id);
        if (!archive) continue;
        const parsed = await parseKnowledgePackageArchive(archive.content as Uint8Array, String(archive.filename));
        store.transaction(() => {
          if (getPackage(String(item.id))?.checksum !== parsed.package.checksum) return;
          for (const derived of parsed.documents) {
            const current = store.get(derived.id);
            if (!current || current.packageId !== parsed.package.id) continue;
            const metadata = { ...current.metadata };
            if (derived.metadata?.chapter_aliases) metadata.chapter_aliases = derived.metadata.chapter_aliases;
            else delete metadata.chapter_aliases;
            const document = { ...current, chapterId: derived.chapterId, chapterTitle: derived.chapterTitle, metadata };
            store.save(document); index(document);
          }
          db.prepare('INSERT OR REPLACE INTO knowledge_package_meta VALUES (?,?)').run('routing-source:' + item.id, parsed.package.checksum);
        });
      }
    })().catch(error => { preparing = undefined; throw error; });
    await preparing;
  }
  function where(filter: KnowledgeFilter = {}) {
    const clauses = ["(json_extract(r.record_json, '$.packageId') IS NULL OR p.enabled=1)"];
    const args: string[] = [];
    const field = (key: string, value?: string) => { if (value) { clauses.push("json_extract(r.record_json, '$." + key + "')=?"); args.push(value); } };
    field('packageId', filter.packageId); field('packageVersion', filter.version);
    field('domain', filter.domain);
    if (filter.chapter) { clauses.push("(json_extract(r.record_json, '$.chapterId')=? OR json_extract(r.record_json, '$.metadata.chapter_number')=?)"); args.push(filter.chapter, filter.chapter); }
    if (filter.kinds?.length) {
      clauses.push("json_extract(r.record_json, '$.kind') IN (" + filter.kinds.map(() => '?').join(',') + ')');
      args.push(...filter.kinds);
    } else if (!filter.includeReferences) clauses.push("COALESCE(json_extract(r.record_json, '$.answerEligible'), 1)=1");
    return { sql: clauses.join(' AND '), args };
  }
  const join = " LEFT JOIN knowledge_packages p ON p.id=json_extract(r.record_json, '$.packageId') ";
  function getPackage(id: string): KnowledgePackage | undefined {
    const row = database().prepare('SELECT record_json, enabled FROM knowledge_packages WHERE id=?').get(id);
    return row ? { ...JSON.parse(String(row.record_json)), enabled: !!row.enabled } : undefined;
  }
  function clearPackage(id: string) {
    const db = database();
    db.prepare("DELETE FROM knowledge_records WHERE document_id IN (SELECT id FROM records WHERE json_extract(record_json, '$.packageId')=?)").run(id);
    db.prepare("DELETE FROM knowledge_substrings WHERE document_id IN (SELECT id FROM records WHERE json_extract(record_json, '$.packageId')=?)").run(id);
    db.prepare("DELETE FROM records WHERE json_extract(record_json, '$.packageId')=?").run(id);
    db.prepare('DELETE FROM knowledge_packages WHERE id=?').run(id);
    db.prepare('DELETE FROM knowledge_archives WHERE id=?').run(id);
    db.prepare('DELETE FROM knowledge_package_meta WHERE key=?').run('routing-source:' + id);
  }
  const result: KnowledgeStore = {
    async put(candidate) {
      database();
      return store.transaction(() => {
        const id = candidate.id?.trim() || 'knowledge_' + createHash('sha256').update((candidate.source || '') + '\0' + candidate.title).digest('hex').slice(0, 20);
        if (store.get(id)?.packageId || candidate.packageId) throw new Error('Package records are managed through package imports.');
        const previous = store.get(id), now = new Date().toISOString();
        const document: KnowledgeDocument = { ...candidate, id, createdAt: previous?.createdAt || now, updatedAt: now };
        store.save(document); index(document); return document;
      });
    },
    async get(id) {
      database();
      const document = store.get(id);
      return document?.packageId && !getPackage(document.packageId)?.enabled ? undefined : document;
    },
    async list(limit, offset, filter) {
      const condition = where(filter);
      return database().prepare('SELECT r.record_json FROM records r' + join + ' WHERE ' + condition.sql +
        ' ORDER BY r.updated_at DESC, r.id LIMIT ? OFFSET ?').all(...condition.args, Math.max(1, Math.min(101, limit)), Math.max(0, offset))
        .map(row => summary(JSON.parse(String(row.record_json))));
    },
    async search(query, limit, previewChars, filter) {
      await prepare();
      const words = tokens(query).slice(0, 100);
      if (!words.length) return [];
      const condition = where(filter);
      const expression = words.map(word => '"' + word.replace(/"/g, '""') + '"').join(' OR ');
      const rows = database().prepare('SELECT r.record_json, bm25(knowledge_records, 0, 5, 1) AS rank FROM knowledge_records ' +
        'JOIN records r ON r.id=knowledge_records.document_id' + join +
        ' WHERE knowledge_records MATCH ? AND ' + condition.sql + ' ORDER BY rank, r.id LIMIT ?')
        .all(expression, ...condition.args, 100);
      const substrings = words.filter(word => [...word].length >= 3);
      if (substrings.length) rows.push(...database().prepare('SELECT r.record_json, bm25(knowledge_substrings) AS rank FROM knowledge_substrings ' +
        'JOIN records r ON r.id=knowledge_substrings.document_id' + join +
        ' WHERE knowledge_substrings MATCH ? AND ' + condition.sql + ' ORDER BY rank, r.id LIMIT 100')
        .all(substrings.map(word => '"' + word.replace(/"/g, '""') + '"').join(' OR '), ...condition.args));
      const shortWords = words.filter(word => /^[a-z0-9]{1,2}$/.test(word));
      if (shortWords.length) rows.push(...database().prepare('SELECT r.record_json, 0 AS rank FROM knowledge_substrings s ' +
        'JOIN records r ON r.id=s.document_id' + join + ' WHERE (' + shortWords.map(() => 'instr(s.text,?)>0').join(' OR ') + ') AND ' + condition.sql +
        ' ORDER BY ' + shortWords.map(() => "CASE WHEN instr(lower(json_extract(r.record_json,'$.title')),?)>0 THEN 1 ELSE 0 END").join('+') + ' DESC,r.id LIMIT 100')
        .all(...shortWords, ...condition.args, ...shortWords));
      const candidates = new Map<string, KnowledgeSearchHit>();
      for (const row of rows) {
        const document: KnowledgeDocument = JSON.parse(String(row.record_json));
        const passage = excerpt(document.content, words, Math.max(100, Math.min(1800, previewChars)));
        const title = normalized(document.title), matched = matchedAliases(normalized(query), aliases(document));
        const rank = Math.max(0, -Number(row.rank));
        const score = passage.coverage * 2 + words.filter(word => title.includes(word)).length * 4
          + matched.length * 4 + rank / (1 + rank) + (normalized(document.recordId || document.id) === normalized(query).trim() ? 10 : 0);
        const hit = { id: document.id, recordId: document.recordId, packageId: document.packageId, packageVersion: document.packageVersion,
          title: document.title, source: document.source, kind: document.kind, domain: document.domain,
          chapterId: document.chapterId, chapterTitle: document.chapterTitle, contentChars: document.content.length,
          text: passage.text, excerptOffset: passage.start, score };
        if (!candidates.has(hit.id) || candidates.get(hit.id)!.score < score) candidates.set(hit.id, hit);
      }
      return [...candidates.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, Math.max(1, Math.min(100, limit)));
    },
    async route(query, limit, filter) {
      const hits = await result.search(query, 100, 100, filter);
      const groups = new Map<string, { id: string; title: string; packageId?: string; domain?: string; score: number; matchedRecords: number }>();
      for (const hit of hits) {
        const id = hit.chapterId || hit.domain || 'documents', key = (hit.packageId || '') + '\0' + id;
        const group = groups.get(key) || { id, title: hit.chapterTitle || hit.domain || 'Documents', packageId: hit.packageId, domain: hit.domain, score: 0, matchedRecords: 0 };
        group.score = Math.max(group.score, hit.score); group.matchedRecords++; groups.set(key, group);
      }
      const condition = where(filter);
      const declared = database().prepare("SELECT json_extract(r.record_json,'$.packageId') AS package_id, COALESCE(json_extract(r.record_json,'$.chapterId'),json_extract(r.record_json,'$.domain'),'documents') AS group_id, json_extract(r.record_json,'$.chapterTitle') AS title, json_extract(r.record_json,'$.domain') AS domain, CASE WHEN json_type(r.record_json,'$.metadata.chapter_aliases')='array' THEN json_extract(r.record_json,'$.metadata.chapter_aliases') END AS aliases, count(*) AS count FROM records r" + join + ' WHERE ' + condition.sql + ' GROUP BY package_id,group_id,aliases').all(...condition.args);
      for (const row of declared) {
        const values: unknown = row.aliases ? JSON.parse(String(row.aliases)) : [];
        const matched = matchedAliases(normalized(query), Array.isArray(values) ? values.filter((alias): alias is string => typeof alias === 'string' && alias.length <= 100) : []);
        if (!matched.length) continue;
        const id = String(row.group_id), packageId = row.package_id == null ? undefined : String(row.package_id), key = (packageId || '') + '\0' + id;
        const group = groups.get(key) || { id, title: String(row.title || row.domain || 'Documents'), packageId, domain: row.domain == null ? undefined : String(row.domain), score: 0, matchedRecords: Number(row.count) };
        const aliasScore = 100 + matched.reduce((score, alias) => score + Math.min(alias.length, 8) ** 2, 0)
          + tokens(query).filter(word => normalized(group.title).includes(word)).length * 2;
        group.score = Math.max(group.score, aliasScore);
        groups.set(key, group);
      }
      return [...groups.values()].sort((a, b) => b.score - a.score).slice(0, limit);
    },
    async packages(limit, offset, enabledOnly) {
      return database().prepare('SELECT record_json, enabled FROM knowledge_packages' + (enabledOnly ? ' WHERE enabled=1' : '') + ' ORDER BY id LIMIT ? OFFSET ?')
        .all(Math.max(1, Math.min(101, limit)), Math.max(0, offset)).map(row => packageSummary({ ...JSON.parse(String(row.record_json)), enabled: !!row.enabled }));
    },
    async getPackage(id) { return getPackage(id); },
    async importPackage(candidate) {
      database();
      return store.transaction(db => {
        const previous = getPackage(candidate.package.id);
        const pack = { ...candidate.package, enabled: previous?.enabled ?? true, importedAt: new Date().toISOString() };
        clearPackage(pack.id);
        db.prepare('INSERT INTO knowledge_packages VALUES (?, ?, ?)').run(pack.id, Number(pack.enabled), JSON.stringify(pack));
        if (candidate.archive) db.prepare('INSERT INTO knowledge_archives VALUES (?, ?, ?)').run(pack.id, candidate.archiveName || 'package.zip', candidate.archive);
        for (const document of candidate.documents) { store.save(document); index(document); }
        db.prepare('INSERT OR REPLACE INTO knowledge_package_meta VALUES (?,?)').run('routing-source:' + pack.id, pack.checksum);
        return packageSummary(pack);
      });
    },
    async setPackageEnabled(id, enabled) { return Number(database().prepare('UPDATE knowledge_packages SET enabled=? WHERE id=?').run(Number(enabled), id).changes) > 0; },
    async deletePackage(id) {
      database();
      return store.transaction(() => { if (!getPackage(id)) return false; clearPackage(id); return true; });
    },
    async delete(id) {
      database();
      return store.transaction(db => {
        if (store.get(id)?.packageId) throw new Error('Delete the package in settings to preserve its reference relationships.');
        db.prepare('DELETE FROM knowledge_records WHERE document_id=?').run(id);
        db.prepare('DELETE FROM knowledge_substrings WHERE document_id=?').run(id);
        return Number(db.prepare('DELETE FROM records WHERE id=?').run(id).changes) > 0;
      });
    },
    async health() { try { database(); return { status: 'healthy' }; } catch (error) { return { status: 'unhealthy', message: error instanceof Error ? error.message : String(error) }; } },
    dispose: store.dispose,
  };
  return result;
}
export function createNodeKnowledgeCapability(input: { directory: string | ((context: CapabilityRunContext) => string) }) {
  return createKnowledgeCapability({ createStore(context) {
    return createFileKnowledgeStore({ directory: typeof input.directory === 'function' ? input.directory(context) : input.directory });
  } });
}
export { parseKnowledgePackageArchive, createKnowledgePackageTemplate, knowledgePackageUploadLimit } from './package.ts';

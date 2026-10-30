import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { createExtractorFromData } from 'node-unrar-js';
import { z } from 'zod';
import { knowledgeDocumentId } from './index.ts';
import type { KnowledgeDocument, KnowledgePackageImport } from './types.ts';

export const knowledgePackageUploadLimit = 32 * 1024 * 1024;
const expandedLimit = 64 * 1024 * 1024, fileLimit = 10_000, recordLimit = 20_000;
const idSchema = z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/);
const collectionSchema = z.object({
  files: z.array(z.string().min(1).max(500)).max(100).optional(),
  kinds: z.array(z.string().min(1).max(100)).max(100).optional(),
  role: z.enum(['knowledge', 'navigation', 'reference']).optional(),
}).passthrough();
export const knowledgePackageManifestSchema = z.object({
  format: z.literal('orbit-knowledge-package').optional(),
  schema_version: z.string().min(1).max(30),
  id: idSchema.optional(), package_id: idSchema.optional(),
  name: z.string().trim().min(1).max(500), version: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(4000).optional(),
  instructions_file: z.string().max(500).optional(),
  routing_index: z.string().max(500).optional(),
  default_answer_kinds: z.array(z.string().min(1).max(100)).min(1).max(100).optional(),
  collections: z.record(z.string(), collectionSchema).optional(),
  snapshot: z.record(z.string(), z.unknown()).optional(),
}).passthrough();
export const knowledgePackageRecordSchema = z.object({
  id: z.string().trim().min(1).max(200).regex(/^[^\u0000-\u001f]+$/),
  kind: z.string().trim().min(1).max(100).default('reference'),
  title: z.string().trim().min(1).max(500), text: z.string().min(1).max(1_000_000),
  domain: z.string().max(100).optional(), chapter_id: z.string().max(200).optional(),
  chapter_title: z.string().max(500).optional(), chapter_number: z.string().max(100).optional(),
  parent_id: z.string().max(200).nullish(), entry_id: z.string().max(200).nullish(),
  linked_section_ids: z.array(z.string().min(1).max(200)).max(100).default([]),
  answer_eligible: z.boolean().optional(), reference_path: z.string().max(500).optional(),
  aliases: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  source_sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  source_span: z.object({ start_line: z.number().int().positive(), end_line: z.number().int().positive() }).optional(),
}).passthrough();

const routingGroupSchema = z.object({
  id: z.string().trim().min(1).max(200), title: z.string().trim().min(1).max(500),
  aliases: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  section_ids: z.array(z.string().min(1).max(200)).max(recordLimit).optional(),
  record_ids: z.array(z.string().min(1).max(200)).max(recordLimit).optional(),
}).passthrough();
const routingIndexSchema = z.object({
  chapters: z.array(routingGroupSchema).max(recordLimit).optional(),
  groups: z.array(routingGroupSchema).max(recordLimit).optional(),
}).refine(value => !!value.chapters || !!value.groups, 'Routing index requires chapters or groups.');

function safePath(value: string) {
  const normalized = value.replace(/\\/g, '/').replace(/\/$/, '');
  if (!normalized || normalized.startsWith('/') || /[:\u0000-\u001f]/.test(normalized)
    || normalized.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('Unsafe archive path: ' + value);
  return normalized;
}
function digest(data: Uint8Array | string) { return createHash('sha256').update(data).digest('hex'); }
function decode(data: Uint8Array) { return new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^\uFEFF/, ''); }

async function unpack(data: Uint8Array) {
  const files = new Map<string, Uint8Array>(), names = new Set<string>();
  let count = 0, total = 0;
  function check(name: string, size: number) {
    const key = safePath(name);
    if (++count > fileLimit || !Number.isSafeInteger(size) || size < 0 || (total += size) > expandedLimit) throw new Error('Knowledge archive exceeds file count or expanded size limits.');
    if (names.has(key.toLowerCase())) throw new Error('Duplicate archive path: ' + key);
    names.add(key.toLowerCase());
    return key;
  }
  if (data[0] === 0x50 && data[1] === 0x4b) {
    const zip = await JSZip.loadAsync(data);
    const entries = Object.values(zip.files);
    const selected: Array<{ key: string; file: JSZip.JSZipObject }> = [];
    for (const file of entries) {
      const original = (file as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName || file.name;
      const declared = (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
      const key = check(original, file.dir ? 0 : Number(declared));
      if (!file.dir && /\.(?:md|json|jsonl|txt)$/i.test(key)) selected.push({ key, file });
    }
    let actual = 0;
    for (const { key, file } of selected) {
      const bytes = await file.async('uint8array');
      if ((actual += bytes.byteLength) > expandedLimit) throw new Error('Expanded archive is too large.');
      files.set(key, bytes);
    }
  } else if (Buffer.from(data.subarray(0, 6)).toString('hex') === '526172211a07') {
    const extractor = await createExtractorFromData({ data: Uint8Array.from(data).buffer });
    // Exhaust the generators: the WASM extractor releases archive handles on completion.
    const listing = extractor.getFileList(), headers = [...listing.fileHeaders];
    if (listing.arcHeader.flags.volume || listing.arcHeader.flags.headerEncrypted) throw new Error('Use a single, unencrypted RAR archive.');
    const selected = new Set<string>();
    for (const header of headers) {
      const key = check(header.name, header.flags.directory ? 0 : header.unpSize);
      if (header.flags.encrypted) throw new Error('Encrypted knowledge archives are not supported.');
      if (!header.flags.directory && /\.(?:md|json|jsonl|txt)$/i.test(key)) selected.add(header.name);
    }
    const extracted = [...extractor.extract({ files: header => selected.has(header.name) }).files];
    let actual = 0;
    for (const file of extracted) if (file.extraction) {
      if ((actual += file.extraction.byteLength) > expandedLimit) throw new Error('Expanded archive is too large.');
      files.set(safePath(file.fileHeader.name), file.extraction);
    }
  } else throw new Error('Upload a ZIP or RAR knowledge package.');
  return files;
}

/** Treat all files as data. Never load or execute any package scripts. */
export async function parseKnowledgePackageArchive(data: Uint8Array, filename: string): Promise<KnowledgePackageImport> {
  if (!data.byteLength || data.byteLength > knowledgePackageUploadLimit) throw new Error('Knowledge package must be between 1 byte and 32 MB.');
  const files = await unpack(data);
  const manifests = [...files.keys()].filter(name => /(^|\/)manifest\.json$/.test(name)
    && [...files.keys()].some(file => file.startsWith(name.slice(0, -'manifest.json'.length) + 'corpus/') && file.endsWith('.jsonl')));
  if (manifests.length !== 1) throw new Error('Archive must contain exactly one manifest.json with a corpus/ directory.');
  const manifestPath = manifests[0], root = manifestPath.slice(0, -'manifest.json'.length);
  const read = (relative: string) => { const bytes = files.get(root + safePath(relative)); if (!bytes) throw new Error('Missing package file: ' + relative); return decode(bytes); };
  const manifest = knowledgePackageManifestSchema.parse(JSON.parse(read('manifest.json')));
  const instructions = manifest.instructions_file ? read(manifest.instructions_file)
    : files.has(root + 'SKILL.md') ? read('SKILL.md') : '';
  if (instructions.length > 50_000) throw new Error('Package instructions exceed 50,000 characters.');
  const skillName = instructions.match(/^---\r?\n[\s\S]*?^name:\s*["']?([a-zA-Z0-9][a-zA-Z0-9._-]*)["']?\s*$/m)?.[1];
  const skillDescription = instructions.match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
  const id = idSchema.parse(manifest.id || manifest.package_id || skillName);
  const checksum = digest(data);
  const version = manifest.version || (typeof manifest.snapshot?.analysis_date === 'string' ? manifest.snapshot.analysis_date : checksum.slice(0, 12));
  if (!version.trim() || version.length > 120) throw new Error('Invalid knowledge package version.');
  const collections = Object.values(manifest.collections || {});
  const declaredFiles = collections.flatMap(collection => collection.files || []).map(safePath);
  const corpus = declaredFiles.length ? [...new Set(declaredFiles)] : [...files.keys()].filter(name => name.startsWith(root + 'corpus/') && name.endsWith('.jsonl')).map(name => name.slice(root.length));
  const documents: KnowledgeDocument[] = [], ids = new Set<string>(), now = new Date().toISOString(), sources = new Map<string, string>();
  for (const file of corpus) {
    if (!file.startsWith('corpus/') || !file.endsWith('.jsonl')) throw new Error('Collection files must be corpus/*.jsonl.');
    const lines = read(file).split(/\r?\n/);
    for (let line = 0; line < lines.length; line++) {
      if (!lines[line].trim()) continue;
      let record: z.infer<typeof knowledgePackageRecordSchema>;
      try { record = knowledgePackageRecordSchema.parse(JSON.parse(lines[line])); }
      catch { throw new Error('Invalid knowledge record: ' + file + ':' + (line + 1)); }
      if (ids.has(record.id)) throw new Error('Duplicate record id: ' + record.id);
      if (documents.length >= recordLimit) throw new Error('Knowledge package exceeds 20,000 records.');
      ids.add(record.id);
      if (record.reference_path) {
        const source = sources.get(record.reference_path) ?? read(record.reference_path);
        sources.set(record.reference_path, source);
        if (record.source_sha256 && digest(source) !== record.source_sha256.toLowerCase()) throw new Error('Source hash mismatch: ' + record.id);
        if (record.source_span) {
          const span = record.source_span, sourceLines = source.split('\n');
          if (span.end_line < span.start_line || span.end_line > sourceLines.length
            || sourceLines.slice(span.start_line - 1, span.end_line).join('\n').trimEnd() !== record.text) throw new Error('Source span does not match record text: ' + record.id);
        }
      } else if (record.source_span || record.source_sha256) throw new Error('Source verification requires reference_path: ' + record.id);
      const collection = collections.find(collection => collection.files?.includes(file) || collection.kinds?.includes(record.kind));
      const eligible = record.answer_eligible !== false && (manifest.default_answer_kinds
        ? manifest.default_answer_kinds.includes(record.kind) : collection?.role !== 'navigation' && collection?.role !== 'reference');
      const { text, ...metadata } = record;
      documents.push({ id: knowledgeDocumentId(id, record.id), recordId: record.id, packageId: id, packageVersion: version,
        title: record.title, content: text, source: record.reference_path, kind: record.kind, domain: record.domain,
        chapterId: record.chapter_id, chapterTitle: record.chapter_title, parentId: record.parent_id || undefined,
        entryId: record.entry_id || undefined, linkedIds: record.linked_section_ids, answerEligible: eligible,
        metadata, createdAt: now, updatedAt: now });
    }
  }
  if (!documents.length || !documents.some(document => document.answerEligible)) throw new Error('Package must contain at least one answer-eligible record.');
  const byId = new Map(documents.map(document => [document.recordId!, document]));
  const routingFiles = manifest.routing_index ? [safePath(manifest.routing_index)]
    : [...files.keys()].filter(name => name.startsWith(root + 'indexes/') && name.endsWith('.json')).map(name => name.slice(root.length));
  for (const file of routingFiles) {
    const value: unknown = JSON.parse(read(file));
    if (!manifest.routing_index && (!value || typeof value !== 'object' || !('chapters' in value || 'groups' in value))) continue;
    const routing = routingIndexSchema.parse(value);
    for (const group of [...(routing.chapters || []), ...(routing.groups || [])]) {
      const members = group.record_ids || group.section_ids;
      const targets = members ? members.map(recordId => {
        const document = byId.get(recordId);
        if (!document) throw new Error('Routing index refers to missing record: ' + recordId);
        return document;
      }) : documents.filter(document => document.chapterId === group.id);
      for (const document of targets) {
        if (document.chapterId && document.chapterId !== group.id) throw new Error('Routing group does not match record chapter: ' + document.recordId);
        document.chapterId = group.id; document.chapterTitle ||= group.title;
        const existing = document.metadata?.chapter_aliases;
        const chapterAliases = [...new Set([
          ...(Array.isArray(existing) ? existing.filter((alias): alias is string => typeof alias === 'string') : []), ...group.aliases,
        ])];
        if (chapterAliases.length > 100) throw new Error('A chapter may declare at most 100 aliases.');
        document.metadata = { ...document.metadata, chapter_aliases: chapterAliases };
      }
    }
  }
  for (const document of documents) {
    for (const linked of [document.parentId, document.entryId, ...(document.linkedIds || [])].filter(Boolean)) if (!ids.has(linked!)) throw new Error('Missing linked record: ' + linked);
    const chain = new Set<string>([document.recordId!]);
    let parent = document.parentId;
    while (parent) {
      if (chain.has(parent) || chain.size > 128) throw new Error('Invalid parent hierarchy: ' + document.recordId);
      chain.add(parent); parent = byId.get(parent)?.parentId;
    }
  }
  return { package: { id, name: manifest.name, version, description: manifest.description || skillDescription?.slice(0, 4000) || '', enabled: true, recordCount: documents.length,
    domains: [...new Set(documents.map(document => document.domain).filter((v): v is string => !!v))],
    importedAt: now, checksum, instructions }, documents, archive: data, archiveName: filename.replace(/^.*[\\/]/, '').slice(0, 255) };
}

/** Generated entirely from static examples; never reads the installed knowledge store. */
export async function createKnowledgePackageTemplate(): Promise<Uint8Array> {
  const zip = new JSZip();
  const manifest = { format: 'orbit-knowledge-package', schema_version: '1.0', id: 'example-business', name: '示例业务知识包', version: '1.0.0',
    description: '仅包含虚构示例。请替换为有来源的业务规则。', default_answer_kinds: ['rule'],
    collections: { business: { files: ['corpus/rules.jsonl'], kinds: ['rule'], role: 'knowledge' }, navigation: { files: ['corpus/navigation.jsonl'], kinds: ['navigation'], role: 'navigation' } },
    instructions_file: 'SKILL.md', routing_index: 'indexes/groups.json' };
  const records = [
    { id: 'EXAMPLE-ENTRY', kind: 'rule', title: '示例申请入口', domain: 'example', chapter_id: 'example', chapter_title: '示例申请',
      text: '这是虚构示例：从“示例业务 → 申请列表”进入，选择“新建申请”。页面入口需结合当前系统核实。', answer_eligible: true },
    { id: 'EXAMPLE-RULE', kind: 'rule', title: '示例申请办理条件', domain: 'example', chapter_id: 'example', chapter_title: '示例申请', parent_id: 'EXAMPLE-ENTRY', entry_id: 'EXAMPLE-ENTRY',
      linked_section_ids: ['EXAMPLE-NAV'], text: '这是虚构示例：只有草稿状态、具备当前对象提交权限且必填信息完整时才能提交。提交成功后读取对象ID、状态及后续任务；不能用点击成功证明业务完成。', answer_eligible: true },
  ];
  const navigation = { id: 'EXAMPLE-NAV', kind: 'navigation', title: '示例页面观察', text: '采集时观察到“示例业务 → 申请列表 → 新建申请”。不证明当前权限或当前页面未改变。', answer_eligible: false };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('corpus/rules.jsonl', records.map(record => JSON.stringify(record)).join('\n') + '\n');
  zip.file('corpus/navigation.jsonl', JSON.stringify(navigation) + '\n');
  zip.file('indexes/groups.json', JSON.stringify({ groups: [{ id: 'example', title: '示例申请', aliases: ['示例办理', 'EXAMPLE'], record_ids: records.map(record => record.id) }] }, null, 2));
  zip.file('SKILL.md', '---\nname: example-business\ndescription: 示例业务知识包\n---\n\n仅作为业务参考。通过 knowledge 的 route/search 定位，再用 get/inspect/context 读取完整条件与关联。实际操作使用已授权工具，并核验实时结果。\n');
  zip.file('manifest.schema.json', JSON.stringify(z.toJSONSchema(knowledgePackageManifestSchema), null, 2));
  zip.file('record.schema.json', JSON.stringify(z.toJSONSchema(knowledgePackageRecordSchema), null, 2));
  zip.file('README.md', '# Orbit 业务知识包模板\n\n所有示例均为虚构，不包含已导入的业务内容。\n\n## 生成流程\n\n1. 修改 manifest.json 的 id、name、version 和 description。id 使用英文字母、数字、点、横线或下划线，后续更新保持相同 id 并修改 version。\n2. 将业务正文写入 corpus/*.jsonl，每行是一个独立 JSON 对象，使用 UTF-8。保留完整条件、表格、例外和证据边界，不能只存摘要。\n3. 每条记录需要 id、kind、title、text。可用 domain、chapter_id、chapter_title 分组；用 parent_id、entry_id、linked_section_ids 关联包内记录。\n4. 在 manifest.collections 声明文件、类型及 role（knowledge/navigation/reference），default_answer_kinds 指定默认回答集合。页面观察、评估题、旧诊断和维护证据不要混入默认规则。\n5. 可将原始手册放入 references/，设置 reference_path。若提供 source_span（起止行，1起算）或 source_sha256，SDK 会核对正文和 UTF-8 原文件（去 BOM）的 SHA-256；修改后必须重新生成。\n6. 可修改 SKILL.md 说明适用范围、检索方法、版本边界和核验要求。它是参考材料，不能授予权限或覆盖用户指令。\n7. 可通过 manifest.routing_index 指向 indexes/groups.json，在 groups（或 chapters）中声明 id、title、aliases、record_ids（或 section_ids）。未显式指定时，也会校验 indexes/*.json 中相同结构的分组。记录级 aliases 可声明缩写和同义称呼。别名用于定位，正文仍保存完整业务规则。\n8. 将上述文件打成 ZIP 或单卷、未加密 RAR。manifest.json 与 corpus/ 可在根目录或同一层包装目录下。上传限制32 MB、展开限制64 MB、最多20,000条记录。\n\n## 导入和查询\n\n设置 → 知识库 → 导入知识包。完整校验和建索引后启用；同 id 的新包原子替换旧包。包和正文存储在当前用户的应用数据目录，不上传 GitHub。使用云端模型时，被检索的片段会按当前模型配置进入模型请求。\n\nknowledge packages 查看范围；route/search 返回候选；get 按 documentId 读取完整记录；inspect 展开关联；context 返回有预算的证据集合。以 nextOffset 和 pendingDocumentIds 继续读取，不把截断内容当作完整规则。\n\n## 边界\n\n不执行包内脚本，不读取网络来源，不自动连接业务系统。章节别名只作为经校验的参考元数据；全文与子串索引由 SDK 重建。新增业务领域只需更换数据，不需要修改 SDK。\n');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

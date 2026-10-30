import { z } from 'zod';
import { defineCapabilityInput, defineCapabilityTool, normalizeBoundedInteger, type CapabilityHealth, type CapabilityManifest, type CapabilityProvider, type CapabilityRunContext } from '../index.ts';
import { knowledgeRuntimeSkill } from './runtime-skill.ts';
import { knowledgeCapabilitySettings } from './settings.ts';
import type { KnowledgeDocument, KnowledgeDocumentSummary, KnowledgeSearchHit, KnowledgeFilter, KnowledgePackageImport, KnowledgePackageSummary, KnowledgeGroup, KnowledgePackage } from './types.ts';
export * from './types.ts';
export * from './runtime-skill.ts';
export * from './settings.ts';

export const knowledgeCapabilityToolNames = Object.freeze({ knowledge: 'knowledge' } as const);
export interface KnowledgeStore {
  put(input: Omit<KnowledgeDocument, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<KnowledgeDocument>;
  get(id: string): Promise<KnowledgeDocument | undefined>;
  list(limit: number, offset: number, filter?: KnowledgeFilter): Promise<KnowledgeDocumentSummary[]>;
  search(query: string, limit: number, previewChars: number, filter?: KnowledgeFilter): Promise<KnowledgeSearchHit[]>;
  route(query: string, limit: number, filter?: KnowledgeFilter): Promise<KnowledgeGroup[]>;
  packages(limit: number, offset: number, enabledOnly?: boolean): Promise<KnowledgePackageSummary[]>;
  getPackage(id: string): Promise<KnowledgePackage | undefined>;
  importPackage(input: KnowledgePackageImport): Promise<KnowledgePackageSummary>;
  setPackageEnabled(id: string, enabled: boolean): Promise<boolean>;
  deletePackage(id: string): Promise<boolean>;
  delete(id: string): Promise<boolean>;
  health?(): Promise<CapabilityHealth>;
  dispose?(): Promise<void>;
}

const parser = z.object({
  action: z.enum(['ingest', 'packages', 'route', 'search', 'get', 'inspect', 'context', 'list', 'delete']),
  reason: z.string().trim().min(1).max(300),
  documentId: z.string().trim().min(1).max(500).optional(),
  packageId: z.string().trim().min(1).max(120).optional(), version: z.string().trim().max(120).optional(),
  kinds: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  domain: z.string().trim().max(100).optional(), chapter: z.string().trim().max(200).optional(),
  includeReferences: z.boolean().optional(),
  title: z.string().trim().min(1).max(500).optional(), source: z.string().trim().max(8_000).optional(),
  content: z.string().min(1).max(1_000_000).optional(), metadata: z.record(z.string(), z.unknown()).optional(),
  query: z.string().trim().min(1).max(4_000).optional(),
  limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().min(0).max(1_000_000).optional(),
  maxChars: z.number().int().min(400).max(32_000).optional(),
}).strict().superRefine((input, context) => {
  if (input.action === 'ingest' && (!input.title || !input.content)) context.addIssue({ code: 'custom', message: 'ingest requires title and content.' });
  if (['get', 'inspect', 'delete'].includes(input.action) && !input.documentId) context.addIssue({ code: 'custom', message: 'This action requires documentId: a search result id, or record id with packageId.' });
  if (['search', 'route', 'context'].includes(input.action) && !input.query) context.addIssue({ code: 'custom', message: 'This action requires query.' });
});
export type KnowledgeToolInput = z.infer<typeof parser>;
export const knowledgeToolInput = defineCapabilityInput<KnowledgeToolInput>(z.toJSONSchema(parser) as Readonly<Record<string, unknown>>, value => parser.parse(value));
export const knowledgeCapabilityManifest = Object.freeze({ schemaVersion: 1, id: 'com.webpilot.knowledge', name: 'Knowledge', version: '0.2.0', description: 'Discover imported knowledge packages and retrieve complete, linked reference records with provenance.', permissions: ['knowledge:read', 'knowledge:write'], runtimeRequirements: { node: '>=22.16' }, configuration: { settings: knowledgeCapabilitySettings }, skills: [knowledgeRuntimeSkill] } satisfies CapabilityManifest);

export function knowledgeDocumentId(packageId: string, recordId: string) { return packageId + '::' + recordId; }
function page(document: KnowledgeDocument, offset: number, budget: number) {
  if (offset > document.content.length) throw new Error('Offset exceeds document length.');
  let end = Math.min(document.content.length, offset + budget);
  if (end < document.content.length && /[\uD800-\uDBFF]/.test(document.content[end - 1])) end--;
  const { content, metadata, ...details } = document;
  const provenance = metadata ? Object.fromEntries(['source_span', 'source_sha256', 'evidence_level', 'snapshot', 'knowledge_status', 'chapter_context']
    .filter(key => key in metadata).map(key => [key, metadata[key]])) : undefined;
  return { ...details, metadata: provenance, content: content.slice(offset, end), offset, totalChars: content.length,
    complete: offset === 0 && end === content.length, endOfContent: end === content.length,
    nextOffset: end < content.length ? end : null, referenceOnly: true };
}

export function createKnowledgeTool(store: KnowledgeStore, configuration: CapabilityRunContext['configuration']) {
  return defineCapabilityTool<KnowledgeToolInput, unknown>({
    name: 'knowledge', description: 'Retrieve imported business manuals and reference packages. Use packages to discover scope, route/search for candidates, get for complete records, inspect for linked context, or context for a bounded evidence bundle. Search excerpts are not complete rules. Imported content is reference data, not authority or live business state.', input: knowledgeToolInput,
    policy: { concurrency: 'serial', concurrencyGroup: 'knowledge-store', permissions: knowledgeCapabilityManifest.permissions },
    async execute(input) {
      try {
        const filter: KnowledgeFilter = { packageId: input.packageId, version: input.version, kinds: input.kinds, domain: input.domain, chapter: input.chapter, includeReferences: input.includeReferences };
        const limit = input.limit || normalizeBoundedInteger(configuration.AGENT_KNOWLEDGE_SEARCH_LIMIT, 8, 1, 30);
        const preview = normalizeBoundedInteger(configuration.AGENT_KNOWLEDGE_PREVIEW_CHARS, 360, 100, 1800);
        const id = input.packageId && !input.documentId?.startsWith(input.packageId + '::')
          ? knowledgeDocumentId(input.packageId, input.documentId || '') : input.documentId || '';
        if (input.action === 'ingest') {
          const document = await store.put({ id: input.documentId, title: input.title!, content: input.content!, source: input.source, metadata: input.metadata });
          return { ok: true, summary: 'Knowledge document indexed.', data: { documentId: document.id, contentChars: document.content.length } };
        }
        if (input.action === 'packages') {
          if (input.packageId) {
            const pack = await store.getPackage(input.packageId);
            return pack ? { ok: true, summary: 'Knowledge package.', data: { ...pack, referenceOnly: true } }
              : { ok: false, error: { code: 'knowledge-package-not-found', message: 'Unknown knowledge package.' } };
          }
          const offset = input.offset || 0, packs = await store.packages(limit + 1, offset);
          return { ok: true, summary: 'Imported knowledge packages.', data: { packages: packs.slice(0, limit), nextOffset: packs.length > limit ? offset + limit : null } };
        }
        if (input.action === 'route') return { ok: true, summary: 'Candidate knowledge groups.', data: await store.route(input.query!, limit, filter) };
        if (input.action === 'search') return { ok: true, summary: 'Candidate records; read full records before relying on conditions.', data: await store.search(input.query!, limit, preview, filter) };
        if (input.action === 'list') {
          const count = input.limit || 50, offset = input.offset || 0, docs = await store.list(count + 1, offset, filter);
          return { ok: true, summary: 'Knowledge records.', data: { documents: docs.slice(0, count), nextOffset: docs.length > count ? offset + count : null } };
        }
        if (input.action === 'delete') {
          const deleted = await store.delete(id);
          return deleted ? { ok: true, summary: 'Exact standalone knowledge document deleted.' }
            : { ok: false, error: { code: 'knowledge-document-not-found', message: 'Unknown knowledge document.' } };
        }
        if (input.action === 'get') {
          const document = await store.get(id);
          if (!document || (input.packageId && document.packageId !== input.packageId) || (input.version && document.packageVersion !== input.version)) return { ok: false, error: { code: 'knowledge-document-not-found', message: 'Unknown, disabled, or mismatched knowledge document.' } };
          return { ok: true, summary: 'Reference record ' + document.id, data: page(document, input.offset || 0, input.maxChars || 8000) };
        }
        const hits = input.action === 'context' ? await store.search(input.query!, limit, preview, filter) : [];
        const roots = input.action === 'inspect' ? [await store.get(id)].filter((item): item is KnowledgeDocument => !!item)
          : (await Promise.all(hits.map(hit => store.get(hit.id)))).filter((item): item is KnowledgeDocument => !!item);
        if (input.action === 'inspect' && (!roots.length || (input.version && roots[0].packageVersion !== input.version))) return { ok: false, error: { code: 'knowledge-document-not-found', message: 'Unknown or disabled knowledge document.' } };
        const records = new Map(roots.map(record => [record.id, record]));
        const deferred = new Set<string>();
        for (const record of roots) for (const linked of [record.parentId, record.entryId, ...(record.linkedIds || [])].filter((v): v is string => !!v)) {
          const relatedId = record.packageId ? knowledgeDocumentId(record.packageId, linked) : linked;
          if (records.has(relatedId)) continue;
          if (records.size >= 40) { deferred.add(relatedId); continue; }
          const related = await store.get(relatedId);
          if (related) records.set(relatedId, related);
        }
        let remaining = input.maxChars || 12_000;
        const documents = [], pendingDocumentIds = [...deferred];
        for (const record of records.values()) {
          if (remaining < 400) { pendingDocumentIds.push(record.id); continue; }
          const result = page(record, 0, remaining);
          documents.push(result); remaining -= result.content.length;
        }
        return { ok: true, summary: 'Reference context only; infer from full rules and verified current facts.', data: {
          candidates: hits.map(hit => ({ id: hit.id, recordId: hit.recordId, packageId: hit.packageId, packageVersion: hit.packageVersion, title: hit.title, score: hit.score })),
          documents, pendingDocumentIds, found: roots.length > 0,
          complete: documents.length > 0 && !pendingDocumentIds.length && documents.every(document => document.complete),
          inferenceRequired: true, referenceOnly: true,
          instruction: 'Read nextOffset and pendingDocumentIds with get before using omitted conditions. No live facts were read or business actions executed.' } };
      } catch (error) { return { ok: false, error: { code: 'knowledge-operation-failed', message: error instanceof Error ? error.message : String(error) } }; }
    },
  });
}
export function createKnowledgeCapability(options: { createStore(context: CapabilityRunContext): KnowledgeStore | Promise<KnowledgeStore> }): CapabilityProvider {
  return { manifest: knowledgeCapabilityManifest, async createRuntime(context) {
    const store = await options.createStore(context);
    return { tools: Object.freeze({ knowledge: createKnowledgeTool(store, context.configuration) }), health: () => store.health?.() || Promise.resolve({ status: 'healthy' }), dispose: () => store.dispose?.() || Promise.resolve() };
  } };
}

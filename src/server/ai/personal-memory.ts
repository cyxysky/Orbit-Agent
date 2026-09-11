import { randomUUID } from 'node:crypto';
import { fuzzyRetrievalScore, normalizeRetrievalText } from '@/lib/fuzzy-retrieval';
import { normalizeApplicationUserId } from '@/server/auth/user-context';
import { getModelSettings } from '@/server/ai/model';
import { memoryApplicabilitySchema, memoryVerificationSchema, memoryExtractionSchema, parseMemoryJson } from './personal-memory-policy';
import type { z } from 'zod';
import {
  deletePersonalMemoryRecord,
  markPersonalMemoryRecordsUsed,
  readPersonalMemoryRecordByIdentity,
  readPersonalMemoryRecords,
  writePersonalMemoryRecord,
  writePersonalMemoryRecords,
  writePersonalMemoryRecordsQueued,
} from '@/server/storage/database-record-store';

export type PersonalMemoryScope = 'global' | 'domain';
export type PersonalMemoryType = 'alias' | 'preference' | 'workflow' | 'domain_fact';
export type PersonalMemoryStatus = 'active' | 'disabled';

export type PersonalMemoryItem = {
  id: string;
  userId: string;
  shared: boolean;
  scope: PersonalMemoryScope;
  domain: string;
  type: PersonalMemoryType;
  key: string;
  aliases: string[];
  value: string;
  text: string;
  confidence: number;
  sourceSessionId?: string;
  sourceMessageIds?: string[];
  sourceUrl?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  useCount: number;
  status: PersonalMemoryStatus;
  recall?: 'always' | 'relevant';
  evidence?: string[];
  durability?: string;
  applicability?: z.infer<typeof memoryApplicabilitySchema>;
  utility?: string;
  verification?: z.infer<typeof memoryVerificationSchema>[];
  verifiedAt?: string;
  expiresAt?: string;
  reviewReason?: string;
  supersededBy?: string;
  history?: Array<{ value: string; applicability?: PersonalMemoryItem['applicability']; evidence?: string[];
    sourceSessionId?: string; sourceMessageIds?: string[]; replacedAt: string }>;
};

export type PersonalMemoryDraft = {
  shared?: unknown;
  scope?: unknown;
  domain?: unknown;
  type?: unknown;
  key?: unknown;
  aliases?: unknown;
  value?: unknown;
  confidence?: unknown;
  sourceUrl?: unknown;
  status?: unknown;
  recall?: unknown;
  evidence?: unknown;
  durability?: unknown;
  applicability?: unknown;
  utility?: unknown;
  verification?: unknown;
  verifiedAt?: unknown;
  expiresAt?: unknown;
  reviewReason?: unknown;
  supersededBy?: unknown;
  history?: PersonalMemoryItem['history'];
};

type PersonalMemoryStoreFile = {
  version: 1;
  items: PersonalMemoryItem[];
};

export type PersonalMemorySearchResult = {
  item: PersonalMemoryItem;
  score: number;
  reasons: string[];
};

export type PersonalMemoryExtractionResult = {
  items: PersonalMemoryItem[];
  rawText: string;
  skipped: boolean;
  reason?: string;
  diagnostics: PersonalMemoryExtractionDiagnostics;
};

export type PersonalMemoryFilterRejectionReason =
  | 'invalid_candidate' | 'missing_new_evidence' | 'unverified_procedure' | 'invalid_scope'
  | 'expired_candidate' | 'review_rejected' | 'invalid_review';

export type PersonalMemoryFilterRejection = {
  index: number;
  key: string;
  type: string;
  durability: string;
  reason: PersonalMemoryFilterRejectionReason;
  reasonDescription: string;
};

export type PersonalMemoryExtractionDiagnostics = {
  candidateCount: number;
  acceptedCount: number;
  rejectedCount: number;
  savedCount: number;
  normalizationRejectedCount: number;
  rejectionReasons: Partial<Record<PersonalMemoryFilterRejectionReason, number>>;
  rejectedCandidates: PersonalMemoryFilterRejection[];
  decisions?: Array<{ index: number; action: string; reason: string; targetIds: string[] }>;
};

export type PersonalMemoryConversationMessage = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
};

const memoryTypes: PersonalMemoryType[] = ['alias', 'preference', 'workflow', 'domain_fact'];
const memoryScopes: PersonalMemoryScope[] = ['global', 'domain'];
const memoryStatuses: PersonalMemoryStatus[] = ['active', 'disabled'];
export function parsePersonalMemoryExtractionOutput(value: unknown) {
  return memoryExtractionSchema.parse(parseMemoryJson(textFromUnknown(value)));
}

function now() {
  return new Date().toISOString();
}

function textFromUnknown(value: unknown) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function compactText(value: unknown, max = 180) {
  const text = textFromUnknown(value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function normalizePersonalMemoryValue(value: unknown) {
  return textFromUnknown(value).replace(/\r\n?/g, '\n').trim();
}

export function normalizePersonalMemoryUserId(value: unknown) {
  return normalizeApplicationUserId(value);
}

export function personalMemoryEnabled() {
  return process.env.AI_PERSONAL_MEMORY_ENABLED !== 'false';
}

export function personalMemoryExtractionEnabled() {
  return personalMemoryEnabled() && process.env.AI_PERSONAL_MEMORY_EXTRACT_ENABLED !== 'false';
}

function personalMemoryPromptLimit() {
  const raw = Number(process.env.AI_PERSONAL_MEMORY_PROMPT_LIMIT || 6);
  return Number.isFinite(raw) ? Math.min(Math.max(Math.floor(raw), 0), 20) : 6;
}

function personalMemoryPromptMaxChars() {
  const raw = Number(process.env.AI_PERSONAL_MEMORY_PROMPT_MAX_CHARS || 12000);
  return Number.isFinite(raw) ? Math.min(Math.max(Math.floor(raw), 1000), 120000) : 12000;
}

export function personalMemoryExtractionInputLimit() {
  const raw = Number(process.env.AI_PERSONAL_MEMORY_EXTRACTION_INPUT_MAX_CHARS || 18000);
  return Number.isFinite(raw) ? Math.min(Math.max(Math.floor(raw), 3000), 60000) : 18000;
}

export function normalizePersonalMemoryDomain(value: unknown) {
  const raw = textFromUnknown(value).trim();
  if (!raw) return '';
  try {
    const url = raw.includes('://') ? new URL(raw) : new URL(`https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return raw
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .replace(/^www\./, '')
      .trim();
  }
}

function domainMatches(memoryDomain: string, currentDomain: string) {
  if (!memoryDomain) return false;
  if (memoryDomain === currentDomain) return true;
  return Boolean(currentDomain && currentDomain.endsWith(`.${memoryDomain}`));
}

function normalizeScope(value: unknown, domain: string): PersonalMemoryScope {
  const scope = textFromUnknown(value).trim();
  if (memoryScopes.includes(scope as PersonalMemoryScope)) return scope as PersonalMemoryScope;
  return domain ? 'domain' : 'global';
}

function normalizeType(value: unknown): PersonalMemoryType {
  const type = textFromUnknown(value).trim();
  if (memoryTypes.includes(type as PersonalMemoryType)) return type as PersonalMemoryType;
  return 'domain_fact';
}

function normalizeStatus(value: unknown): PersonalMemoryStatus {
  const status = textFromUnknown(value).trim();
  if (memoryStatuses.includes(status as PersonalMemoryStatus)) return status as PersonalMemoryStatus;
  return 'active';
}

function normalizeConfidence(value: unknown) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return 0.75;
  return Math.min(Math.max(confidence, 0), 1);
}

function normalizeKey(value: unknown) {
  return compactText(value, 120);
}

function normalizeAliases(value: unknown, key = '') {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const item of source) {
    const alias = compactText(item, 80);
    const normalized = alias.toLowerCase();
    if (!alias || normalized === key.toLowerCase() || seen.has(normalized)) continue;
    seen.add(normalized);
    aliases.push(alias);
  }
  return aliases.slice(0, 8);
}

function itemText(input: Pick<PersonalMemoryItem, 'key' | 'value' | 'aliases' | 'domain' | 'scope' | 'type'>) {
  const aliases = input.aliases.length ? ` aliases: ${input.aliases.join(', ')}` : '';
  const domain = input.scope === 'domain' && input.domain ? ` domain: ${input.domain}` : '';
  return compactText(`${input.type} ${input.key}: ${input.value}${aliases}${domain}`, 360);
}

export function normalizeMemoryDraft(input: PersonalMemoryDraft, defaults: {
  userId: string;
  domain?: string;
  sourceSessionId?: string;
  sourceMessageIds?: string[];
  sourceUrl?: string;
}): Omit<PersonalMemoryItem, 'id' | 'createdAt' | 'updatedAt' | 'lastUsedAt' | 'useCount'> | undefined {
  const rawDomain = normalizePersonalMemoryDomain(input.domain || defaults.domain || '');
  const scope = normalizeScope(input.scope, rawDomain);
  const domain = scope === 'domain' ? rawDomain : '';
  const key = normalizeKey(input.key);
  const value = normalizePersonalMemoryValue(input.value);
  if (!key || !value) return undefined;
  const type = normalizeType(input.type);
  const aliases = normalizeAliases(input.aliases, key);
  return {
    userId: defaults.userId,
    shared: input.shared === true,
    scope,
    domain,
    type,
    key,
    aliases,
    value,
    text: itemText({ key, value, aliases, domain, scope, type }),
    confidence: normalizeConfidence(input.confidence),
    sourceSessionId: defaults.sourceSessionId,
    sourceMessageIds: defaults.sourceMessageIds,
    sourceUrl: compactText(input.sourceUrl || defaults.sourceUrl || '', 2000) || undefined,
    status: normalizeStatus(input.status),
    ...(input.recall === 'always' || input.recall === 'relevant' ? { recall: input.recall } : {}),
    ...(Array.isArray(input.evidence) ? { evidence: input.evidence.filter((quote): quote is string => typeof quote === 'string').slice(0, 8).map((quote) => quote.slice(0, 500)) } : {}),
    ...(typeof input.durability === 'string' ? { durability: input.durability } : {}),
    ...(input.applicability ? { applicability: memoryApplicabilitySchema.parse(input.applicability) } : {}),
    ...(typeof input.utility === 'string' ? { utility: compactText(input.utility, 300) } : {}),
    ...(Array.isArray(input.verification) ? { verification: input.verification.map((entry) => memoryVerificationSchema.parse(entry)).slice(0, 4) } : {}),
    ...(typeof input.verifiedAt === 'string' ? { verifiedAt: input.verifiedAt } : {}),
    ...(typeof input.expiresAt === 'string' ? { expiresAt: input.expiresAt } : {}),
    ...(typeof input.reviewReason === 'string' ? { reviewReason: compactText(input.reviewReason, 400) } : {}),
    ...(typeof input.supersededBy === 'string' ? { supersededBy: input.supersededBy } : {}),
    ...(input.history ? { history: input.history.slice(-5) } : {}),
  };
}

export function normalizeStoreItem(value: unknown): PersonalMemoryItem | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Partial<PersonalMemoryItem>;
  const userId = normalizePersonalMemoryUserId(record.userId);
  const draft = normalizeMemoryDraft(record, {
    userId,
    domain: record.domain,
    sourceSessionId: record.sourceSessionId,
    sourceMessageIds: record.sourceMessageIds,
    sourceUrl: record.sourceUrl,
  });
  if (!draft) return undefined;
  const timestamp = now();
  const id = compactText(record.id, 120) || `mem_${randomUUID()}`;
  return {
    ...draft,
    id,
    createdAt: textFromUnknown(record.createdAt).trim() || timestamp,
    updatedAt: textFromUnknown(record.updatedAt).trim() || timestamp,
    lastUsedAt: textFromUnknown(record.lastUsedAt).trim() || undefined,
    useCount: Math.max(0, Math.floor(Number(record.useCount) || 0)),
  };
}

async function readStore(input: {
  domain?: string;
  includeDisabled?: boolean;
  includeShared?: boolean;
  limit?: number;
  userId?: string;
} = {}): Promise<PersonalMemoryStoreFile> {
  const items = (await readPersonalMemoryRecords<PersonalMemoryItem>(input))
    .map(normalizeStoreItem)
    .filter((item): item is PersonalMemoryItem => Boolean(item));
  return { version: 1, items };
}

function memoryIdentity(item: Pick<PersonalMemoryItem, 'userId' | 'scope' | 'domain' | 'type' | 'key'>) {
  return [
    item.userId,
    item.scope,
    item.domain,
    item.type,
    item.key.toLowerCase(),
  ].join('\u0001');
}

export async function listPersonalMemoryItems(input: {
  userId?: unknown;
  domain?: unknown;
  includeDisabled?: boolean;
  limit?: number;
} = {}) {
  const userId = normalizePersonalMemoryUserId(input.userId);
  const domain = normalizePersonalMemoryDomain(input.domain);
  const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(500, Math.floor(Number(input.limit)))) : undefined;
  const items = (await readStore({
    domain,
    userId,
    includeShared: true,
    includeDisabled: input.includeDisabled === true,
    limit,
  })).items.filter((item) => {
    if (item.userId !== userId && !item.shared) return false;
    if (!input.includeDisabled && item.status !== 'active') return false;
    if (!domain) return true;
    return item.scope === 'global' || domainMatches(item.domain, domain);
  });
  return limit ? items.slice(0, limit) : items;
}

export async function getPersonalMemoryItem(id: string, userId?: unknown) {
  const normalizedUserId = normalizePersonalMemoryUserId(userId);
  return (await readPersonalMemoryRecords<PersonalMemoryItem>({
    ids: [id],
    userId: normalizedUserId,
    includeShared: true,
  })).map(normalizeStoreItem).find((item): item is PersonalMemoryItem => Boolean(item));
}

export async function savePersonalMemoryItem(input: PersonalMemoryDraft & {
  id?: unknown;
  userId?: unknown;
  sourceSessionId?: string;
  sourceMessageIds?: string[];
}) {
  const userId = normalizePersonalMemoryUserId(input.userId);
  const draft = normalizeMemoryDraft(input, {
    userId,
    domain: textFromUnknown(input.domain),
    sourceSessionId: input.sourceSessionId,
    sourceMessageIds: input.sourceMessageIds,
    sourceUrl: textFromUnknown(input.sourceUrl),
  });
  if (!draft) throw new Error('Personal memory item requires key and value.');
  const timestamp = now();
  const requestedId = compactText(input.id, 120);
  const requestedItem = requestedId
    ? (await readPersonalMemoryRecords<PersonalMemoryItem>({ ids: [requestedId] }))
      .map(normalizeStoreItem)
      .find((item): item is PersonalMemoryItem => Boolean(item))
    : undefined;
  if (requestedItem && requestedItem.userId !== userId) {
    throw new Error('Only the memory creator can edit this shared memory.');
  }
  const identityItem = await readPersonalMemoryRecordByIdentity<PersonalMemoryItem>({
    userId,
    scope: draft.scope,
    domain: draft.domain,
    type: draft.type,
    key: draft.key,
  });
  const previous = requestedItem || (identityItem ? normalizeStoreItem(identityItem) : undefined);
  const item: PersonalMemoryItem = {
    ...draft,
    shared: input.shared === undefined ? previous?.shared ?? false : draft.shared,
    id: previous?.id || requestedId || `mem_${randomUUID()}`,
    createdAt: previous?.createdAt || timestamp,
    updatedAt: timestamp,
    lastUsedAt: previous?.lastUsedAt,
    useCount: previous?.useCount || 0,
    status: draft.status,
  };
  await writePersonalMemoryRecord(item);
  return item;
}

export async function savePersonalMemoryItems(
  inputs: Array<PersonalMemoryDraft & { id?: unknown }>,
  userIdValue?: unknown,
  options: { queued?: boolean } = {},
) {
  const userId = normalizePersonalMemoryUserId(userIdValue);
  const store = await readStore({ userId, includeShared: true });
  const byIdentity = new Map(store.items.map((item) => [memoryIdentity(item), item]));
  const timestamp = now();
  const saved: PersonalMemoryItem[] = [];
  let created = 0;
  let updated = 0;
  for (const input of inputs) {
    const draft = normalizeMemoryDraft(input, {
      userId,
      domain: textFromUnknown(input.domain),
      sourceUrl: textFromUnknown(input.sourceUrl),
    });
    if (!draft) continue;
    const previous = byIdentity.get(memoryIdentity(draft));
    if (previous && previous.userId !== userId) continue;
    const item: PersonalMemoryItem = {
      ...draft,
      shared: input.shared === undefined ? previous?.shared ?? false : draft.shared,
      id: previous?.id || compactText(input.id, 120) || `mem_${randomUUID()}`,
      createdAt: previous?.createdAt || timestamp,
      updatedAt: timestamp,
      lastUsedAt: previous?.lastUsedAt,
      useCount: previous?.useCount || 0,
      status: draft.status,
    };
    if (previous) updated += 1;
    else created += 1;
    byIdentity.set(memoryIdentity(item), item);
    saved.push(item);
  }
  const result = { created, items: saved, updated };
  if (saved.length && options.queued) return writePersonalMemoryRecordsQueued(saved).then(() => result);
  if (saved.length) await writePersonalMemoryRecords(saved);
  return result;
}

export async function updatePersonalMemoryItem(id: string, patch: PersonalMemoryDraft, userId?: unknown, source?: {
  sourceSessionId?: string; sourceMessageIds?: string[]; sourceUrl?: string;
}) {
  const normalizedUserId = normalizePersonalMemoryUserId(userId);
  const previous = (await readPersonalMemoryRecords<PersonalMemoryItem>({
    ids: [id],
    userId: normalizedUserId,
    includeShared: false,
  })).map(normalizeStoreItem).find((item): item is PersonalMemoryItem => Boolean(item));
  if (!previous) return undefined;
  const draft = normalizeMemoryDraft({
    ...previous,
    ...patch,
    aliases: patch.aliases ?? previous.aliases,
    domain: patch.domain ?? previous.domain,
    scope: patch.scope ?? previous.scope,
    type: patch.type ?? previous.type,
  }, {
    userId: previous.userId,
    domain: previous.domain,
    sourceSessionId: source?.sourceSessionId || previous.sourceSessionId,
    sourceMessageIds: source?.sourceMessageIds || previous.sourceMessageIds,
    sourceUrl: source?.sourceUrl || previous.sourceUrl,
  });
  if (!draft) throw new Error('Personal memory item requires key and value.');
  const item: PersonalMemoryItem = {
    ...previous,
    ...draft,
    id: previous.id,
    createdAt: previous.createdAt,
    updatedAt: now(),
    lastUsedAt: previous.lastUsedAt,
    useCount: previous.useCount,
    status: normalizeStatus(patch.status ?? previous.status),
    expiresAt: patch.expiresAt === null ? undefined : draft.expiresAt,
    applicability: patch.applicability === null ? undefined : draft.applicability,
  };
  const changed = previous.value !== item.value || previous.scope !== item.scope || previous.domain !== item.domain
    || previous.type !== item.type || JSON.stringify(previous.applicability) !== JSON.stringify(item.applicability);
  if (changed && !source) {
    item.history = [...(previous.history || []), { value: previous.value, applicability: previous.applicability,
      evidence: previous.evidence, sourceSessionId: previous.sourceSessionId, sourceMessageIds: previous.sourceMessageIds,
      replacedAt: item.updatedAt }].slice(-5);
    // A manual edit is authoritative user content, but is not the old verified claim.
    item.evidence = undefined;
    item.verification = undefined;
    item.verifiedAt = undefined;
    item.reviewReason = undefined;
    item.durability = undefined;
    item.utility = undefined;
    item.sourceSessionId = undefined;
    item.sourceMessageIds = undefined;
  }
  if (!source && patch.status === 'active') item.supersededBy = undefined;
  await writePersonalMemoryRecord(item);
  return item;
}

export async function deletePersonalMemoryItem(id: string, userId?: unknown) {
  const normalizedUserId = normalizePersonalMemoryUserId(userId);
  const deleted = (await readPersonalMemoryRecords<PersonalMemoryItem>({
    ids: [id],
    userId: normalizedUserId,
    includeShared: false,
  })).map(normalizeStoreItem).find((item): item is PersonalMemoryItem => Boolean(item));
  return deleted && await deletePersonalMemoryRecord(id, normalizedUserId) ? deleted : undefined;
}

export function rankPersonalMemory(items: PersonalMemoryItem[], input: {
  userId: string; query?: unknown; domain: string; limit: number;
}): PersonalMemorySearchResult[] {
  const results: PersonalMemorySearchResult[] = [];
  // Resolve the same key/alias before ranking, so a stale high-scoring duplicate
  // cannot beat the user's newer correction. Private and site-specific rules win.
  const identities = new Set<string>();
  const ordered = [...items].filter((item) => item.status === 'active' && !item.supersededBy
    && (!item.expiresAt || Date.parse(item.expiresAt) > Date.now())
    && (!item.applicability?.contextTerms.length || item.applicability.contextTerms.some((term) => {
      const query = normalizeRetrievalText(input.query);
      const context = normalizeRetrievalText(term);
      return /\p{Script=Han}/u.test(context) ? query.includes(context) : ` ${query} `.includes(` ${context} `);
    }))
    && (item.userId === input.userId || item.shared)
    && (item.scope === 'global' || domainMatches(item.domain, input.domain))).sort((a, b) =>
      Number(b.userId === input.userId) - Number(a.userId === input.userId)
      || Number(b.scope === 'domain') - Number(a.scope === 'domain')
      || b.domain.length - a.domain.length
      || b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
  for (const item of ordered) {
    const keys = [item.key, ...item.aliases].map((key) => `${item.type}:${normalizeRetrievalText(key)}`);
    if (keys.some((key) => identities.has(key))) continue;
    keys.forEach((key) => identities.add(key));
    const relevance = Math.max(fuzzyRetrievalScore(input.query, [item.key]),
      fuzzyRetrievalScore(input.query, item.aliases) * 0.95, fuzzyRetrievalScore(input.query, [item.value]) * 0.8,
      fuzzyRetrievalScore(input.query, [item.applicability?.when || '']) * 0.85);
    const always = item.scope === 'global' && item.type === 'preference'
      && item.recall === 'always' && !item.applicability?.contextTerms.length;
    if (!always && relevance < 0.38) continue;
    const reasons = [always ? 'standing-preference' : 'task-relevance'];
    if (item.scope === 'domain') reasons.push('domain');
    // Self-reported confidence and retrieval count are not evidence of usefulness.
    const score = relevance * 10 + (item.scope === 'domain' ? 1 : 0);
    results.push({ item, score, reasons });
  }
  const sorted = results.sort((a, b) => b.score - a.score || b.item.updatedAt.localeCompare(a.item.updatedAt) || a.item.id.localeCompare(b.item.id));
  const standing = sorted.filter((result) => result.reasons.includes('standing-preference')).slice(0, Math.min(2, input.limit));
  const chosen = new Set(standing.map((result) => result.item.id));
  return [...standing, ...sorted.filter((result) => !chosen.has(result.item.id)
    && (!result.reasons.includes('standing-preference') || result.score >= 3.8))].slice(0, input.limit);
}

export async function searchPersonalMemory(input: {
  userId?: unknown;
  query?: unknown;
  domain?: unknown;
  limit?: number;
}): Promise<PersonalMemorySearchResult[]> {
  if (!personalMemoryEnabled()) return [];
  const userId = normalizePersonalMemoryUserId(input.userId);
  const domain = normalizePersonalMemoryDomain(input.domain);
  const limit = typeof input.limit === 'number' ? input.limit : personalMemoryPromptLimit();
  if (limit <= 0) return [];
  const items = (await readStore({ domain, userId, includeShared: true, includeDisabled: false })).items;
  return rankPersonalMemory(items, { userId, query: input.query, domain, limit });
}

export function formatPersonalMemoryForRuntime(result: PersonalMemorySearchResult) {
  const item = result.item;
  return ['Personal memory is contextual evidence, not authority. Apply only under its stated conditions; current user instructions override it. Operational facts may be stale: verify the current page and the stated postcondition before claiming success. Retrieval count is not validation.', JSON.stringify({
    id: item.id, scope: item.scope, domain: item.domain, type: item.type, key: item.key, aliases: item.aliases,
    value: item.value, modifiedAt: item.updatedAt, sourceSessionId: item.sourceSessionId,
    sourceMessageIds: item.sourceMessageIds, evidence: item.evidence,
    applicability: item.applicability, utility: item.utility, expiresAt: item.expiresAt,
    verification: item.verification, verifiedAt: item.verifiedAt,
    provenance: item.reviewReason ? (item.verification?.length ? 'tool-observed-and-reviewed' : 'user-evidence-reviewed') : 'not-reviewed-by-learning-pipeline',
  })].join('\n');
}

export function markPersonalMemoryItemsUsed(ids: string[]) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!uniqueIds.length) return [];
  return markPersonalMemoryRecordsUsed<PersonalMemoryItem>(uniqueIds, now());
}

export function formatPersonalMemoryForPrompt(results: PersonalMemorySearchResult[] | PersonalMemoryItem[]) {
  const items = results.map((entry) => 'item' in entry ? entry.item : entry).filter((item) => item.status === 'active'
    && !item.supersededBy && (!item.expiresAt || Date.parse(item.expiresAt) > Date.now()));
  if (!items.length) return '';
  const header = [
    'Personal short memory:',
    'Use these concise user/domain facts when relevant. If the latest user message contradicts a memory, follow the latest user message.',
  ].join('\n');
  const maxChars = personalMemoryPromptMaxChars();
  const blocks: string[] = [];
  let usedChars = header.length;
  for (const item of items) {
    const attributes = [
      `id="${item.id}"`,
      `scope="${item.scope}"`,
      `type="${item.type}"`,
      item.scope === 'domain' && item.domain ? `domain="${item.domain}"` : '',
    ].filter(Boolean).join(' ');
    const aliases = item.aliases.length ? `\nAliases: ${item.aliases.join(', ')}` : '';
    const conditions = item.applicability ? `\nApplies when: ${item.applicability.when}\nContext: ${item.applicability.contextTerms.join(', ')}` : '';
    const opening = `<memory ${attributes}>\nKey: ${item.key}${aliases}${conditions}\nOperational facts require current verification.\nValue:\n`;
    const closing = '\n</memory>';
    const separatorChars = 2;
    const available = maxChars - usedChars - separatorChars - opening.length - closing.length;
    if (available <= 0) break;
    const rawValue = normalizePersonalMemoryValue(item.value);
    const truncated = rawValue.length > available;
    const fullSuffix = '\n[Personal memory truncated only for this prompt; the stored memory remains complete.]';
    const suffix = truncated ? fullSuffix.slice(0, available) : '';
    const valueLimit = Math.max(0, available - suffix.length);
    const value = rawValue.slice(0, valueLimit).trimEnd();
    const block = `${opening}${value}${suffix}${closing}`;
    blocks.push(block);
    usedChars += separatorChars + block.length;
    if (truncated) break;
  }
  return [header, ...blocks].join('\n\n');
}

export {
  extractPersonalMemoryFromTurn, reviewPersonalMemoryCandidates,
  analyzeDurablePersonalMemoryDrafts, filterDurablePersonalMemoryDrafts,
} from './personal-memory-learning';

export function personalMemoryDiagnostics() {
  return {
    enabled: personalMemoryEnabled(),
    extractionEnabled: personalMemoryExtractionEnabled(),
    promptLimit: personalMemoryPromptLimit(),
    promptMaxChars: personalMemoryPromptMaxChars(),
    provider: getModelSettings().provider,
    model: getModelSettings().model,
  };
}

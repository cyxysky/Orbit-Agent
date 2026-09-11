import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import {
  getPersonalMemoryItem, markPersonalMemoryItemsUsed, normalizePersonalMemoryDomain,
  normalizePersonalMemoryUserId, searchPersonalMemory, reviewPersonalMemoryCandidates,
  type PersonalMemoryItem,
} from './personal-memory';
import { memoryCandidateSchema } from './personal-memory-policy';

export type PersonalMemoryToolContext = {
  userId?: unknown;
  currentUrl?: string;
  getCurrentUrl?: () => string;
  sourceSessionId?: string;
  sourceMessageIds?: string[];
  userMessages?: string[];
  readOnly?: boolean;
  usedMemoryIds?: Set<string>;
  abortSignal?: AbortSignal;
};

function toolMemoryItem(item: PersonalMemoryItem) {
  return { id: item.id, scope: item.scope, domain: item.domain, type: item.type,
    key: item.key, aliases: item.aliases, value: item.value, status: item.status,
    applicability: item.applicability, utility: item.utility, evidence: item.evidence,
    verifiedAt: item.verifiedAt, verification: item.verification, expiresAt: item.expiresAt,
    reviewReason: item.reviewReason, updatedAt: item.updatedAt };
}

export function createPersonalMemoryTools(context: PersonalMemoryToolContext): ToolSet {
  const userId = normalizePersonalMemoryUserId(context.userId);
  const usedMemoryIds = context.usedMemoryIds || new Set<string>();
  const currentUrl = () => context.getCurrentUrl?.() || context.currentUrl || '';
  // One object schema for every provider; validation of action-specific fields happens below.
  const inputSchema = z.object({
    ...memoryCandidateSchema.partial().shape,
    action: z.enum(['search', 'save', 'update', 'disable']),
    query: z.string().trim().min(1).max(1000).optional(),
    limit: z.number().int().min(1).max(20).optional(),
    id: z.string().min(1).max(160).optional(),
  }).strict();

  return { memory: tool({
    description: 'Search or maintain durable memory. Save only a scoped, useful user rule with exact evidence from the CURRENT user message, applicability and utility. Corrections update existing IDs; disable only on an explicit forget request. All writes are independently reviewed for source support, reuse value, duplicates and conflicts. Do not infer habits from repeated instructions. Operational lessons are extracted from verified tool results after the turn; do not fabricate tool verification here.',
    inputSchema,
    execute: async (input) => {
      if (input.action === 'search') {
        if (!input.query) throw new Error('Memory search requires query.');
        const results = await searchPersonalMemory({ userId, query: input.query,
          domain: normalizePersonalMemoryDomain(currentUrl()), limit: input.limit });
        const unused = results.map(({ item }) => item.id).filter((id) => !usedMemoryIds.has(id));
        if (unused.length) {
          await markPersonalMemoryItemsUsed(unused);
          unused.forEach((id) => usedMemoryIds.add(id));
        }
        return { items: results.map(({ item, score, reasons }) => ({ ...toolMemoryItem(item), score, reasons })) };
      }
      if (context.readOnly) throw new Error('Personal memory tools are read-only in this agent.');
      if (!context.sourceSessionId || !context.sourceMessageIds?.[0] || !context.userMessages?.length) {
        throw new Error('Memory write requires an identified current user message.');
      }
      const previous = input.id ? await getPersonalMemoryItem(input.id, userId) : undefined;
      if (input.action !== 'save' && (!previous || previous.userId !== userId)) {
        throw new Error('Memory update/disable requires an existing memory owned by the current user.');
      }
      const { action, query: _query, limit: _limit, id: _id, ...fields } = input;
      void _query; void _limit; void _id;
      const candidate = memoryCandidateSchema.parse({
        ...(previous ? { scope: previous.scope, domain: previous.domain, type: previous.type,
          key: previous.key, aliases: previous.aliases, value: previous.value,
          applicability: previous.applicability, utility: previous.utility } : {}),
        ...fields,
        ...(action === 'disable' ? {
          applicability: previous?.applicability || { when: previous!.key, contextTerms: [] },
          utility: 'Stop applying the specific rule the user has explicitly withdrawn.',
          durability: 'user_correction', verification: [],
        } : {}),
      });
      if (candidate.durability === 'verified_procedure') throw new Error('Procedural verification is collected from actual tool results after the turn.');
      const reviewed = await reviewPersonalMemoryCandidates({
        userId, currentUrl: currentUrl(), userMessage: context.userMessages[context.userMessages.length - 1],
        userMessageId: context.sourceMessageIds[0], sourceMessageIds: [context.sourceMessageIds[0]],
        sourceSessionId: context.sourceSessionId, assistantReply: '', steps: [], candidates: [candidate],
        requestedAction: action, targetId: action !== 'save' ? input.id : undefined,
        receiptSuffix: JSON.stringify({ action, id: input.id, candidate }), abortSignal: context.abortSignal,
      });
      return { changed: reviewed.items.length > 0, skipped: reviewed.skipped, reason: reviewed.reason,
        items: reviewed.items.map(toolMemoryItem), review: reviewed.diagnostics };
    },
  }) };
}

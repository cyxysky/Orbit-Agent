import { createHash, randomUUID } from 'node:crypto';
import { generateText } from 'ai';
import { z } from 'zod';
import { aiTelemetry } from './ai-sdk-runtime';
import { getModel } from './model';
import type { StepExecutionResult } from './schemas/runtime.schema';
import {
  normalizeMemoryDraft, normalizePersonalMemoryDomain, normalizePersonalMemoryUserId,
  normalizeStoreItem, personalMemoryExtractionEnabled, personalMemoryExtractionInputLimit,
  type PersonalMemoryConversationMessage, type PersonalMemoryDraft, type PersonalMemoryItem,
  type PersonalMemoryExtractionResult, type PersonalMemoryFilterRejection,
  type PersonalMemoryFilterRejectionReason,
} from './personal-memory';
import {
  evidenceIsInMessage, memoryCandidateSchema, memoryExtractionSchema, memoryReviewSchema,
  parseMemoryJson, personalMemoryQualityPolicy, type MemoryCandidate,
} from './personal-memory-policy';
import {
  commitPersonalMemoryReview, hasPersonalMemoryReceipt, readPersonalMemoryRecords,
} from '@/server/storage/database-record-store';

type LearningSource = {
  userId?: unknown;
  currentUrl?: string;
  targetUrl?: string;
  userMessage: string;
  userMessageId?: string;
  assistantReply: string;
  conversation?: PersonalMemoryConversationMessage[];
  steps: StepExecutionResult[];
  sourceSessionId: string;
  sourceMessageIds: string[];
  abortSignal?: AbortSignal;
};

const rejectionDescriptions: Record<PersonalMemoryFilterRejectionReason, string> = {
  invalid_candidate: '候选缺少有效的适用条件、未来用途或证据结构。',
  missing_new_evidence: '证据不是本轮用户原话，不能重新提炼旧消息或助手结论。',
  unverified_procedure: '缺少来自本轮成功工具结果的可核验依据。',
  invalid_scope: '站点经验缺少域名，或域名与本轮操作环境不符。',
  expired_candidate: '候选的有效期已经结束。',
  review_rejected: '语义复核判定不应写入。',
  invalid_review: '复核结果不完整，或试图修改无权修改的记忆。',
};

function rejection(index: number, item: PersonalMemoryDraft, reason: PersonalMemoryFilterRejectionReason): PersonalMemoryFilterRejection {
  return { index, key: typeof item.key === 'string' ? item.key : '', type: String(item.type || ''),
    durability: String(item.durability || ''), reason, reasonDescription: rejectionDescriptions[reason] };
}

/** Exact source binding, separate from the model's semantic quality review. */
export function analyzeDurablePersonalMemoryDrafts(items: PersonalMemoryDraft[], userMessages: string[], context: {
  steps?: StepExecutionResult[]; domain?: string;
} = {}) {
  const accepted: MemoryCandidate[] = [];
  const rejected: PersonalMemoryFilterRejection[] = [];
  items.forEach((input, index) => {
    const parsed = memoryCandidateSchema.safeParse(input);
    if (!parsed.success) { rejected.push(rejection(index, input, 'invalid_candidate')); return; }
    const item = parsed.data;
    let reason: PersonalMemoryFilterRejectionReason | undefined;
    if (item.expiresAt && Date.parse(item.expiresAt) <= Date.now()) reason = 'expired_candidate';
    const domain = normalizePersonalMemoryDomain(item.domain || context.domain);
    if ((item.scope === 'domain' && !domain)
      || (item.durability === 'verified_procedure' && (item.scope !== 'domain' || domain !== context.domain))) reason = 'invalid_scope';
    if (item.durability === 'verified_procedure') {
      const supported = (item.type === 'workflow' || item.type === 'domain_fact') && item.verification.length > 0
        && item.verification.every((proof) => {
          const step = context.steps?.find((entry) => entry.index === proof.stepIndex);
          const tool = step?.tools?.[proof.toolIndex];
          return step?.status === 'passed' && tool?.ok === true && Boolean(tool.result)
            && evidenceIsInMessage(proof.quote, tool.result!);
        });
      if (!supported) reason = 'unverified_procedure';
    } else if (!item.evidence.length || item.verification.length
      || item.evidence.some((quote) => !userMessages.some((message) => evidenceIsInMessage(quote, message)))) {
      reason = 'missing_new_evidence';
    }
    // Even a procedural candidate cannot smuggle invented user quotations.
    if (item.evidence.some((quote) => !userMessages.some((message) => evidenceIsInMessage(quote, message)))) reason = 'missing_new_evidence';
    if (reason) rejected.push(rejection(index, item, reason));
    else accepted.push({ ...item, domain: item.scope === 'domain' ? domain : '' });
  });
  return { items: accepted, rejected };
}

export function filterDurablePersonalMemoryDrafts(items: PersonalMemoryDraft[], userMessages: string[]) {
  return analyzeDurablePersonalMemoryDrafts(items, userMessages).items;
}

function sourceKey(input: LearningSource, suffix = '') {
  const message = input.userMessageId || input.sourceMessageIds[0] || input.userMessage;
  return createHash('sha256').update(JSON.stringify([input.sourceSessionId, message, suffix])).digest('hex');
}

function result(input: Partial<PersonalMemoryExtractionResult> = {}): PersonalMemoryExtractionResult {
  return { items: [], rawText: '', skipped: false, diagnostics: {
    candidateCount: 0, acceptedCount: 0, rejectedCount: 0, savedCount: 0,
    normalizationRejectedCount: 0, rejectionReasons: {}, rejectedCandidates: [], decisions: [],
  }, ...input };
}

function toolEvidence(steps: StepExecutionResult[]) {
  return steps.map((step) => ({ index: step.index, action: step.action, expected: step.expected,
    status: step.status, tools: (step.tools || []).map((tool, toolIndex) => ({
      toolIndex, name: tool.name, ok: tool.ok, input: JSON.stringify(tool.input)?.slice(0, 1000), result: tool.result?.slice(0, 2000),
    })) }));
}

function sourceForModel(input: LearningSource) {
  return {
    now: new Date().toISOString(), currentUrl: input.currentUrl, targetUrl: input.targetUrl,
    newUserEvidence: { id: input.userMessageId || input.sourceMessageIds[0], content: input.userMessage },
    // Keep roles and ordering. Prior messages are only for resolving "that" / "same".
    priorContextNotNewEvidence: (input.conversation || []).filter((message) => message.id !== (input.userMessageId || input.sourceMessageIds[0]))
      .slice(-6).map((message) => ({ ...message, content: message.content.slice(0, 800) })),
    newToolEvidence: toolEvidence(input.steps),
  };
}

async function askMemoryModel(schema: z.ZodType, instruction: string, data: unknown, abortSignal?: AbortSignal) {
  const serialized = JSON.stringify(data);
  if (serialized.length > personalMemoryExtractionInputLimit()) throw new Error('Memory evidence exceeds input budget; no memory was changed.');
  const response = await generateText({
    model: getModel(), temperature: 0.1, maxRetries: 1,
    abortSignal: abortSignal ? AbortSignal.any([abortSignal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    system: `${personalMemoryQualityPolicy}\n${instruction}\nReturn only JSON matching this schema:\n${JSON.stringify(z.toJSONSchema(schema))}`,
    prompt: serialized, telemetry: aiTelemetry('personal-memory-learning'),
  });
  return { data: schema.parse(parseMemoryJson(response.text)), rawText: response.text };
}

function unchangedValue(a: PersonalMemoryItem, b: PersonalMemoryItem) {
  return a.value === b.value && a.scope === b.scope && a.domain === b.domain && a.type === b.type
    && JSON.stringify(a.applicability) === JSON.stringify(b.applicability) && a.expiresAt === b.expiresAt;
}

/** Every AI-originated write goes through this same source and semantic review. */
export async function reviewPersonalMemoryCandidates(input: LearningSource & {
  candidates: PersonalMemoryDraft[];
  requestedAction?: 'save' | 'update' | 'disable';
  targetId?: string;
  receiptSuffix?: string;
}): Promise<PersonalMemoryExtractionResult> {
  const userId = normalizePersonalMemoryUserId(input.userId);
  const key = sourceKey(input, input.receiptSuffix);
  if (await hasPersonalMemoryReceipt(userId, key)) return result({ skipped: true, reason: 'already-processed' });
  const domain = normalizePersonalMemoryDomain(input.currentUrl || input.targetUrl);
  const filtered = analyzeDurablePersonalMemoryDrafts(input.candidates, [input.userMessage], { steps: input.steps, domain });
  const expectedItems = await readPersonalMemoryRecords<PersonalMemoryItem>({ userId, includeShared: true, includeDisabled: true });
  const existing = expectedItems.map(normalizeStoreItem).filter((item): item is PersonalMemoryItem => Boolean(item));
  const output = result();
  output.diagnostics.candidateCount = input.candidates.length;
  output.diagnostics.rejectedCandidates = [...filtered.rejected];
  const writes = new Map<string, PersonalMemoryItem>();
  if (filtered.items.length) {
    const reviewSource = sourceForModel(input);
    // The reviewer sees the complete results for cited tools, not unrelated tool logs.
    const cited = new Set(filtered.items.flatMap((item) => item.verification.map((proof) => `${proof.stepIndex}:${proof.toolIndex}`)));
    reviewSource.newToolEvidence = reviewSource.newToolEvidence.map((step) => ({ ...step,
      tools: step.tools.filter((tool) => cited.has(`${step.index}:${tool.toolIndex}`)),
    })).filter((step) => step.tools.length);
    const answer = await askMemoryModel(memoryReviewSchema, [
      'Independently review candidates against exact source evidence and ALL existing memories. Do not trust the proposer\'s utility or classification.',
      'Return exactly one decision per candidate index. Prefer discard when no durable change in future behavior is demonstrated.',
      'Reject claims not entailed by the cited evidence, unnecessary general knowledge, overgeneralization, and false success heuristics.',
      'Compare meaning, not just keys. An equivalent existing memory means discard. A changed rule means update the existing ID; preserve unaffected constraints in the returned item.',
      'Exception: a procedure independently revalidated by NEW tool evidence may update its verification without changing its claim. Repeated user wording is not revalidation.',
      'Also compare candidates with each other: keep only one proposed write for the same fact. Current URL is a hint, not proof that every earlier tool ran on that site. Verify procedure scope against the cited tool input/output; discard if the environment cannot be established.',
      'For update targetIds[0] is the canonical item; other targetIds may only be semantically duplicate/contradictory records that the same new evidence replaces. Never change unrelated subjects.',
      'Do not broaden applicability. Respect the user\'s exact project/environment/site qualifiers; include them in contextTerms or domain.',
      'Do not recreate disabled or superseded facts under a new key. Shared memories owned by another user are read-only; a private contextual override may be created when the user actually contradicts one.',
      'disable requires a clear CURRENT user request to forget/withdraw the specific rule. Corrections generally update rather than discard the whole rule.',
      'For create/update return the complete reviewed item. User quotes and tool proof must remain exact; no invented evidence. For discard/disable omit item.',
      'If requestedAction=disable, allow only discard or disable of requestedTargetId. If requestedAction=update, do not update unrelated IDs.',
    ].join('\n'), {
      ...reviewSource, candidates: filtered.items,
      requestedAction: input.requestedAction, requestedTargetId: input.targetId,
      existingMemory: existing.map(({ id, userId: owner, scope, domain, type, key, aliases, value, status, applicability, expiresAt, supersededBy }) => ({
        id, editable: owner === userId, scope, domain, type, key, aliases, value, status, applicability, expiresAt, supersededBy,
      })),
    }, input.abortSignal);
    const review = memoryReviewSchema.parse(answer.data);
    output.rawText = answer.rawText;
    if (review.decisions.length !== filtered.items.length || new Set(review.decisions.map((decision) => decision.index)).size !== filtered.items.length
      || review.decisions.some((decision) => decision.index >= filtered.items.length)) throw new Error('Incomplete memory review; no memory was changed.');
    output.diagnostics.decisions = review.decisions.map(({ index, action, reason, targetIds }) => ({ index, action, reason, targetIds }));
    const timestamp = new Date().toISOString();
    for (const decision of review.decisions) {
      const candidate = filtered.items[decision.index];
      const reject = (reason: PersonalMemoryFilterRejectionReason) => output.diagnostics.rejectedCandidates.push(rejection(decision.index, candidate, reason));
      if (decision.action === 'discard') { reject('review_rejected'); continue; }
      const targets = decision.targetIds.map((id) => existing.find((entry) => entry.id === id));
      if ((decision.action === 'create' && targets.length)
        || (decision.action !== 'create' && (!targets.length || targets.some((entry) => !entry || entry.userId !== userId || entry.status !== 'active')))
        || targets.some((entry) => entry && writes.has(entry.id))
        || (input.targetId && (decision.targetIds[0] !== input.targetId || decision.targetIds.length !== 1))
        || (input.requestedAction === 'disable' && decision.action !== 'disable')) { reject('invalid_review'); continue; }
      if (decision.action === 'disable') {
        if (!['user_correction', 'explicit_remember'].includes(candidate.durability) || !candidate.evidence.length) { reject('invalid_review'); continue; }
        for (const target of targets) writes.set(target!.id, { ...target!, status: 'disabled', updatedAt: timestamp, reviewReason: decision.reason });
        continue;
      }
      const checked = analyzeDurablePersonalMemoryDrafts(decision.item ? [decision.item] : [], [input.userMessage], { steps: input.steps, domain });
      if (checked.items.length !== 1) { reject('invalid_review'); continue; }
      const reviewed = checked.items[0];
      const sourceIds = reviewed.durability === 'verified_procedure'
        ? [...new Set(reviewed.verification.flatMap((proof) => {
          const messageId = input.steps.find((step) => step.index === proof.stepIndex)?.messageId;
          return messageId ? [messageId] : input.sourceMessageIds.slice(-1);
        }).concat(reviewed.evidence.length ? [input.userMessageId || input.sourceMessageIds[0]] : []))]
        : [input.userMessageId || input.sourceMessageIds[0]];
      const draft = normalizeMemoryDraft({ ...reviewed, reviewReason: decision.reason,
        recall: reviewed.recall === 'always' && reviewed.scope === 'global' && reviewed.type === 'preference'
          && !reviewed.applicability.contextTerms.length ? 'always' : 'relevant',
        ...(reviewed.verification.length ? { verifiedAt: timestamp } : {}),
      }, { userId, sourceSessionId: input.sourceSessionId, sourceMessageIds: sourceIds.filter(Boolean), sourceUrl: input.currentUrl || input.targetUrl });
      if (!draft) { reject('invalid_review'); continue; }
      const previous = targets[0];
      const item: PersonalMemoryItem = {
        ...draft, id: previous?.id || `mem_${randomUUID()}`, key: previous?.key || draft.key,
        aliases: [...new Set([...(previous?.aliases || []), ...draft.aliases, ...(previous && previous.key !== draft.key ? [draft.key] : [])])].slice(0, 8),
        shared: previous?.shared || false, status: 'active', createdAt: previous?.createdAt || timestamp, updatedAt: timestamp,
        useCount: previous?.useCount || 0, lastUsedAt: previous?.lastUsedAt,
        history: previous ? [...(previous.history || []), { value: previous.value, applicability: previous.applicability,
          evidence: previous.evidence, sourceSessionId: previous.sourceSessionId, sourceMessageIds: previous.sourceMessageIds, replacedAt: timestamp }].slice(-5) : [],
      };
      const otherRecords = [...existing, ...writes.values()].filter((entry) => entry.id !== item.id && entry.userId === userId);
      if (otherRecords.some((entry) => entry.scope === item.scope && entry.domain === item.domain && entry.type === item.type
        && (entry.key.toLowerCase() === item.key.toLowerCase() || (entry.value === item.value && JSON.stringify(entry.applicability) === JSON.stringify(item.applicability)))
        && !decision.targetIds.includes(entry.id))) { reject('invalid_review'); continue; }
      const sameClaim = previous && unchangedValue(previous, item);
      if (sameClaim) item.history = previous.history;
      if (!previous || !sameClaim || targets.length > 1 || reviewed.durability === 'verified_procedure') writes.set(item.id, item);
      for (const duplicate of targets.slice(1)) writes.set(duplicate!.id, { ...duplicate!, status: 'disabled',
        supersededBy: item.id, reviewReason: decision.reason, updatedAt: timestamp });
    }
  }
  output.diagnostics.rejectedCount = output.diagnostics.rejectedCandidates.length;
  output.diagnostics.acceptedCount = Math.max(0, input.candidates.length - output.diagnostics.rejectedCount);
  for (const entry of output.diagnostics.rejectedCandidates) {
    output.diagnostics.rejectionReasons[entry.reason] = (output.diagnostics.rejectionReasons[entry.reason] || 0) + 1;
  }
  input.abortSignal?.throwIfAborted();
  output.diagnostics.savedCount = writes.size;
  const outcome = await commitPersonalMemoryReview({ userId, sourceKey: key, expectedItems, items: [...writes.values()], report: output.diagnostics });
  if (outcome !== 'committed') {
    output.diagnostics.savedCount = 0;
    return { ...output, skipped: true, reason: outcome === 'conflict' ? 'memory-changed-during-review' : 'already-processed' };
  }
  output.items = [...writes.values()];
  output.diagnostics.savedCount = output.items.length;
  return output;
}

export async function extractPersonalMemoryFromTurn(input: LearningSource): Promise<PersonalMemoryExtractionResult> {
  if (!personalMemoryExtractionEnabled()) return result({ skipped: true, reason: 'disabled' });
  const userId = normalizePersonalMemoryUserId(input.userId);
  if (await hasPersonalMemoryReceipt(userId, sourceKey(input))) return result({ skipped: true, reason: 'already-processed' });
  const evidence = sourceForModel(input);
  // Drop supplementary context before refusing oversized authoritative evidence.
  while (JSON.stringify(evidence).length > personalMemoryExtractionInputLimit() && evidence.priorContextNotNewEvidence.length) evidence.priorContextNotNewEvidence.shift();
  while (JSON.stringify(evidence).length > personalMemoryExtractionInputLimit() && evidence.newToolEvidence.length) evidence.newToolEvidence.shift();
  const answer = await askMemoryModel(memoryExtractionSchema, [
    'Propose zero to four valuable memories from NEW user/tool evidence only. Most turns should produce {"items":[]}.',
    'Prior context is only for resolving references, never for discovering more memories. Never quote prior messages as new evidence.',
    'A correction, durable explicit choice, reusable alias, explicit remember request or verified non-obvious operational lesson can be a candidate.',
    'Return the claim with its future trigger, concrete benefit and exact evidence. Do not infer preferences from repeated task instructions.',
  ].join('\n'), evidence, input.abortSignal);
  const candidates = memoryExtractionSchema.parse(answer.data).items;
  return reviewPersonalMemoryCandidates({ ...input, candidates });
}

import { randomUUID } from 'node:crypto';
import type { ModelMessage } from 'ai';
import { assembleRuntimeContext, runtimeContextMessageRef, type RuntimeContextInput, type ContextCompressionProgress } from './runtime-context-assembler';
import { contextSummaryInputTokens, contextSegmentMarker, summarizeContextBatch, parseContextSummary, ContextSummaryError, type ContextSummaryGenerator, type ContextSummaryRetry } from './runtime-semantic-summary';

type Checkpoint = { messages: ModelMessage[]; activeMessages: ModelMessage[]; continuationSummary: string; removedIndexes: number[]; compressedMessages: number; segmentRecords: ModelMessage[] };
/** Owns compaction and persistence; the assembler remains a deterministic projection. */
export async function prepareRuntimeContext(input: RuntimeContextInput & {
  continuationSummary: string; compressionTriggerTokens: number; compressionTargetTokens: number;
  generateSummary: ContextSummaryGenerator;
  onSummaryRetry?: (retry: ContextSummaryRetry) => void | Promise<void>;
  failedCompactions?: Map<string, ContextSummaryError>;
  abortSignal?: AbortSignal;
  refreshObservations?: () => Promise<ModelMessage[]>;
  onProgress?: (progress: ContextCompressionProgress, messages: ModelMessage[]) => void | Promise<void>;
  onCheckpoint?: (checkpoint: Checkpoint) => void | Promise<void>;
}) {
  let active = [...input.messages];
  let state = parseContextSummary(input.continuationSummary) || { version: 3 as const, epoch: 0 };
  let observations = input.observations;
  const currentRequest = input.pinnedUser || input.messages[input.currentUserIndex];
  const pinnedUser = currentRequest?.role === 'user' ? currentRequest : undefined;
  const pinnedRef = pinnedUser && runtimeContextMessageRef(pinnedUser);
  if (pinnedUser && !active.some(message => runtimeContextMessageRef(message) === pinnedRef)) {
    const hasHandoff = typeof active[0]?.content === 'string' && active[0].content.startsWith(contextSegmentMarker);
    active.splice(hasHandoff ? 1 : 0, 0, pinnedUser);
  }
  const build = () => assembleRuntimeContext({ ...input, messages: active, pinnedUser, observations });
  let packet = build();
  const beforeTokens = packet.manifest.estimatedTokensAfter;
  let compressedMessages = 0;
  const segmentRecords: ModelMessage[] = [];
  let compactionFailure: string | undefined;
  let compactionFailureDetails: Record<string, unknown> | undefined;
  let compactionStopReason: { code: string; message: string } | undefined;
  let attemptedCompaction = false;
  const configuredKeepRecent = Number(process.env.AI_CONTEXT_KEEP_RECENT_BLOCKS);
  const keepRecent = Number.isFinite(configuredKeepRecent) ? Math.max(4, Math.floor(configuredKeepRecent)) : 4;
  const maximumInputTokens = Math.min(18000, input.inputBudgetTokens);
  for (let attempt = 0; packet.manifest.estimatedTokensAfter > (attempt === 0 ? input.compressionTriggerTokens : input.compressionTargetTokens) && attempt < 8; attempt++) {
    const blocks: ModelMessage[][] = [];
    for (let start = 0; start < active.length;) {
      let end = start + 1;
      if (active[start].role === 'assistant') while (active[end]?.role === 'tool') end++;
      blocks.push(active.slice(start, end)); start = end;
    }
    const source: ModelMessage[] = [];
    const pinnedIndex = pinnedRef ? active.findLastIndex(message => runtimeContextMessageRef(message) === pinnedRef) : -1;
    let selectionStop = { code: 'recent-interactions-retained', message: 'Only retained recent interactions remain outside the historical handoff.' };
    let selectedMessageCount = 0;
    for (const block of blocks.slice(0, Math.max(0, blocks.length - keepRecent))) {
      const calls = block.flatMap(message => message.role === 'assistant' && Array.isArray(message.content) ? message.content.filter(part => part.type === 'tool-call').map(part => part.toolCallId) : []);
      const results = new Set(block.flatMap(message => Array.isArray(message.content) ? message.content.filter(part => part.type === 'tool-result').map(part => part.toolCallId) : []));
      if (calls.some(id => !results.has(id))) {
        selectionStop = { code: 'incomplete-tool-exchange', message: 'The next historical interaction has no complete tool results.' };
        break;
      }
      // Keep the exact current request in the active window, at the replacement boundary.
      const historical = block.filter((_message, index) => selectedMessageCount + index !== pinnedIndex);
      if (contextSummaryInputTokens(pinnedUser, [...source, ...historical]) > maximumInputTokens) {
        selectionStop = { code: 'source-input-limit', message: 'The next complete interaction exceeds the summary input capacity.' };
        break;
      }
      source.push(...historical); selectedMessageCount += block.length;
    }
    const onlyHandoff = source.length === 1 && typeof source[0].content === 'string' && source[0].content.startsWith(contextSegmentMarker);
    if (!source.length || onlyHandoff) {
      compactionStopReason = selectionStop;
      break;
    }
    const retained = active.slice(selectedMessageCount);
    const pinRemoved = pinnedUser && pinnedIndex < selectedMessageCount;
    const replace = (message: ModelMessage) => [message, ...(pinRemoved ? [pinnedUser] : []), ...retained];
    const sourceKey = runtimeContextMessageRef({ role: 'user', content: JSON.stringify({
      source: source.map(runtimeContextMessageRef), pinnedUser: pinnedUser && runtimeContextMessageRef(pinnedUser), maximumInputTokens,
    }) });
    const previousFailure = input.failedCompactions?.get(sourceKey);
    if (previousFailure) {
      compactionFailure = previousFailure.message;
      compactionFailureDetails = { ...previousFailure.details, retrySkipped: true, reusedFailure: true,
        summaryRequestMade: false, reason: 'Same source batch already failed in this turn.' };
      if (packet.manifest.estimatedTokensAfter > input.inputBudgetTokens) throw previousFailure;
      break;
    }
    attemptedCompaction = true;
    await input.onProgress?.({ stage: 'start', completedMessages: compressedMessages, totalMessages: source.length, beforeTokens, afterTokens: packet.manifest.estimatedTokensAfter }, packet.messages);
    let candidate: Awaited<ReturnType<typeof summarizeContextBatch>>;
    try {
      candidate = await summarizeContextBatch({ currentRequest: pinnedUser, messages: source, maximumInputTokens, generate: input.generateSummary,
        onRetry: input.onSummaryRetry, abortSignal: input.abortSignal,
        validate: (message) => {
          const replacement = replace(message);
          if (assembleRuntimeContext({ ...input, messages: replacement, pinnedUser, observations }).manifest.estimatedTokensAfter >= packet.manifest.estimatedTokensAfter) {
            throw new ContextSummaryError('Handoff did not reduce the context window. Summarize more concisely without copying source payloads.');
          }
        } });
    } catch (error) {
      input.abortSignal?.throwIfAborted();
      const failure = error instanceof ContextSummaryError ? error : new ContextSummaryError(error instanceof Error ? error.message : String(error), { cause: error });
      input.failedCompactions?.set(sourceKey, failure);
      compactionFailure = failure.message;
      compactionFailureDetails = failure.details;
      if (packet.manifest.estimatedTokensAfter > input.inputBudgetTokens) throw failure;
      break;
    }
    input.abortSignal?.throwIfAborted();
    const replacement = replace(candidate.message);
    const nextState = { version: 3 as const, epoch: state.epoch + 1, handoffRef: candidate.segment.ref, pinnedUserRef: pinnedUser ? runtimeContextMessageRef(pinnedUser) : undefined };
    // Commit the complete replacement and audit evidence before publishing it in memory.
    await input.onCheckpoint?.({ messages: assembleRuntimeContext({ ...input, messages: replacement, pinnedUser, observations }).messages,
      activeMessages: replacement, continuationSummary: JSON.stringify(nextState), removedIndexes: [],
      compressedMessages: compressedMessages + source.length, segmentRecords: [candidate.message] });
    active = replacement; state = nextState; compressedMessages += source.length; segmentRecords.push(candidate.message);
    packet = build();
    await input.onProgress?.({ stage: 'batch', completedMessages: compressedMessages, totalMessages: compressedMessages, beforeTokens, afterTokens: packet.manifest.estimatedTokensAfter }, packet.messages);
    if (packet.manifest.estimatedTokensAfter <= input.compressionTargetTokens) break;
  }
  if (compressedMessages && !compactionFailure && packet.manifest.estimatedTokensAfter > input.compressionTargetTokens) {
    compactionStopReason ??= { code: 'batch-limit', message: 'Reached the batch limit; saved handoffs and remaining source messages were preserved.' };
  }
  // Summary generation (including a failed, best-effort attempt) can outlive a
  // screenshot's action window. Refresh after ALL batches, before model dispatch;
  // refreshing only successful batches leaves the fallback path using stale IDs.
  if (attemptedCompaction && input.refreshObservations) {
    input.abortSignal?.throwIfAborted();
    observations = await input.refreshObservations();
    packet = build();
  }
  if (compressedMessages && !compactionFailure) {
    if (packet.manifest.estimatedTokensAfter <= input.compressionTargetTokens) compactionStopReason = undefined;
    else compactionStopReason ??= { code: 'refreshed-context', message: 'Refreshed request context remains above the compression target.' };
  }
  if (packet.manifest.estimatedTokensAfter > input.inputBudgetTokens) throw new ContextSummaryError('Context budget exceeded. Current request, required constraints and latest image were preserved; no model request was sent.', {
    details: { code: 'input-capacity-exceeded', compactionStopReason, estimatedTokens: packet.manifest.estimatedTokensAfter, inputBudgetTokens: input.inputBudgetTokens },
  });
  packet.manifest.id = `ctxreq_${randomUUID()}`;
  packet.manifest.createdAt = new Date().toISOString();
  packet.manifest.epoch = state.epoch;
  packet.manifest.compactionFailure = compactionFailure;
  packet.manifest.compactionFailureDetails = compactionFailureDetails;
  packet.manifest.compactionStopReason = compactionStopReason;
  packet.manifest.estimatedTokensBefore = beforeTokens;
  packet.manifest.summaryMessageCount = compressedMessages;
  return { ...packet, activeMessages: active, continuationSummary: JSON.stringify(state), compressedMessages, segmentRecords, removedIndexes: [] as number[] };
}

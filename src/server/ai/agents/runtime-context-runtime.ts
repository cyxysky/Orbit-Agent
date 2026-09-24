import { randomUUID } from 'node:crypto';
import type { ModelMessage } from 'ai';
import { assembleRuntimeContext, runtimeContextMessageRef, type RuntimeContextInput, type ContextCompressionProgress } from './runtime-context-assembler';
import { contextSummaryInputTokens, contextSegmentMarker, summarizeContextBatch, parseContextSummary, ContextSummaryError, type ContextSummaryGenerator, type ContextSummaryRetry } from './runtime-semantic-summary';
import { isOriginalBrowserChatUserMessage } from './browser-chat-model-context';
import { skillBodyKeysForPreservation } from './hidden-runtime-skills';
import { hasSourceFileReceipt, prepareRuntimeSourceFiles } from './runtime-source-files';

type Checkpoint = { messages: ModelMessage[]; activeMessages: ModelMessage[]; continuationSummary: string; removedIndexes: number[]; compressedMessages: number; segmentRecords: ModelMessage[] };
/** Owns compaction and persistence; the assembler remains a deterministic projection. */
export async function prepareRuntimeContext(input: RuntimeContextInput & {
  continuationSummary: string; compressionTriggerTokens: number; compressionTargetTokens: number;
  sourceRecords?: Record<string, ModelMessage>;
  generateSummary: ContextSummaryGenerator;
  onSummaryRetry?: (retry: ContextSummaryRetry) => void | Promise<void>;
  failedCompactions?: Map<string, ContextSummaryError>;
  abortSignal?: AbortSignal;
  refreshObservations?: () => Promise<ModelMessage[]>;
  onProgress?: (progress: ContextCompressionProgress, messages: ModelMessage[]) => void | Promise<void>;
  onCheckpoint?: (checkpoint: Checkpoint) => void | Promise<void>;
}) {
  const files = prepareRuntimeSourceFiles({ messages: input.messages, records: input.sourceRecords,
    inputBudgetTokens: input.inputBudgetTokens,
    query: JSON.stringify([input.pinnedUser?.content || input.messages[input.currentUserIndex]?.content,
      input.messages.filter(message => message.role === 'assistant').slice(-3).map(message => message.content)]) });
  input = { ...input, knowledge: [...input.knowledge, ...files.knowledge] };
  const sourceFileReceipts = files.messages.filter(hasSourceFileReceipt);
  let active = [...files.messages];
  let state = parseContextSummary(input.continuationSummary) || { version: 3 as const, epoch: 0 };
  let observations = input.observations;
  const currentRequest = input.pinnedUser || input.messages[input.currentUserIndex];
  const pinnedUser = currentRequest?.role === 'user' ? currentRequest : undefined;
  const pinnedRef = pinnedUser && runtimeContextMessageRef(pinnedUser);
  if (pinnedUser && !active.some(message => runtimeContextMessageRef(message) === pinnedRef)) {
    const hasHandoff = typeof active[0]?.content === 'string' && active[0].content.startsWith(contextSegmentMarker);
    active.splice(hasHandoff ? 1 : 0, 0, pinnedUser);
  }
  const build = () => {
    const packet = assembleRuntimeContext({ ...input, messages: active, pinnedUser, observations });
    packet.manifest.sourceFiles = files.stats;
    return packet;
  };
  let packet = build();
  const beforeTokens = packet.manifest.estimatedTokensAfter;
  let compressedMessages = 0;
  const segmentRecords: ModelMessage[] = [...sourceFileReceipts];
  let compactionFailure: string | undefined;
  let compactionFailureDetails: Record<string, unknown> | undefined;
  let compactionStopReason: { code: string; message: string } | undefined;
  let attemptedCompaction = false;
  let lastCompactionError: ContextSummaryError | undefined;
  const createdHandoffs = new Set<string>();
  const rejectedBatchKeys = new Set<string>();
  const configuredKeepRecent = Number(process.env.AI_CONTEXT_KEEP_RECENT_BLOCKS);
  const keepRecent = Number.isFinite(configuredKeepRecent) ? Math.max(4, Math.floor(configuredKeepRecent)) : 4;
  const maximumInputTokens = Math.min(64000, Math.floor(input.inputBudgetTokens * 0.6));
  while (packet.manifest.estimatedTokensAfter > (compressedMessages ? input.compressionTargetTokens : input.compressionTriggerTokens)) {
    const blocks: Array<{ messages: ModelMessage[]; start: number; end: number }> = [];
    for (let start = 0; start < active.length;) {
      let end = start + 1;
      if (active[start].role === 'assistant') while (active[end]?.role === 'tool') end++;
      blocks.push({ messages: active.slice(start, end), start, end }); start = end;
    }
    // Every loaded Skill receipt remains exact, including older versions.
    const protectedSkillBlocks = new Set(blocks
      .filter(block => skillBodyKeysForPreservation(block.messages).size > 0)
      .map(block => block.messages));
    type SourceBatch = { start: number; end: number; messages: ModelMessage[]; sourceTokens: number; key: string };
    const batches: SourceBatch[] = [];
    let pending: { start: number; end: number; messages: ModelMessage[] } | undefined;
    const emptyPromptTokens = contextSummaryInputTokens(pinnedUser, []);
    const flush = () => {
      if (!pending) return;
      const sourceTokens = contextSummaryInputTokens(pinnedUser, pending.messages) - emptyPromptTokens;
      const key = runtimeContextMessageRef({ role: 'user', content: JSON.stringify({
        source: pending.messages.map(runtimeContextMessageRef), pinnedUser: pinnedUser && runtimeContextMessageRef(pinnedUser), maximumInputTokens,
      }) });
      batches.push({ ...pending, sourceTokens, key });
      pending = undefined;
    };
    let oversizedBlocks = 0;
    let incompleteBlocks = 0;
    for (const block of blocks.slice(0, Math.max(0, blocks.length - keepRecent))) {
      const messages = block.messages;
      const calls = messages.flatMap(message => message.role === 'assistant' && Array.isArray(message.content) ? message.content.filter(part => part.type === 'tool-call').map(part => part.toolCallId) : []);
      const results = new Set(messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(part => part.type === 'tool-result').map(part => part.toolCallId) : []));
      const incomplete = messages[0]?.role === 'tool' || calls.some(id => !results.has(id));
      // A handoff cannot cross an exact user instruction or Skill body. Doing so
      // moves later history ahead of that instruction and changes its meaning.
      const protectedBlock = messages.some(message => isOriginalBrowserChatUserMessage(message)
        || (pinnedRef && runtimeContextMessageRef(message) === pinnedRef))
        || protectedSkillBlocks.has(messages)
        || messages.some(message => createdHandoffs.has(runtimeContextMessageRef(message)));
      if (incomplete || protectedBlock) {
        flush();
        if (incomplete) incompleteBlocks++;
        continue;
      }
      const proposed = [...(pending?.messages || []), ...messages];
      if (contextSummaryInputTokens(pinnedUser, proposed) > maximumInputTokens) {
        flush();
        if (contextSummaryInputTokens(pinnedUser, messages) > maximumInputTokens) {
          oversizedBlocks++;
          continue;
        }
      }
      if (!pending) pending = { start: block.start, end: block.end, messages: [...messages] };
      else { pending.end = block.end; pending.messages.push(...messages); }
    }
    flush();
    // A short isolated exchange can cost more as a handoff once its source
    // references are included. Prefer substantial batches, including earlier
    // handoffs, and keep searching after one batch fails validation.
    const eligible = batches.filter(batch => batch.sourceTokens >= Math.max(600, batch.messages.length * 75));
    eligible.sort((left, right) => right.sourceTokens - left.sourceTokens || left.start - right.start);
    const available = eligible.filter(candidate => !rejectedBatchKeys.has(candidate.key) && !input.failedCompactions?.has(candidate.key));
    const candidates = available.slice(0, 4);
    if (!candidates.length) {
      const cachedFailure = eligible.map(candidate => input.failedCompactions?.get(candidate.key)).find(Boolean);
      if (cachedFailure && !lastCompactionError) {
        lastCompactionError = cachedFailure;
        compactionFailure = cachedFailure.message;
        compactionFailureDetails = { ...cachedFailure.details, retrySkipped: true, reusedFailure: true,
          summaryRequestMade: false, candidateCount: eligible.length };
      }
      compactionStopReason = batches.length === 0
        ? { code: oversizedBlocks ? 'source-input-limit' : incompleteBlocks ? 'incomplete-tool-exchange' : 'protected-content-retained',
          message: 'No complete historical batch can be summarized while retaining exact user instructions, Skill bodies and recent interactions.' }
        : { code: eligible.length ? 'candidate-failures' : 'no-beneficial-batch',
          message: eligible.length ? 'Every eligible historical batch failed in this turn; their original messages were preserved.'
            : 'Only short historical batches remain; a handoff would add more context than it removes.' };
      break;
    }
    attemptedCompaction = true;
    const waveMessageCount = candidates.reduce((count, candidate) => count + candidate.messages.length, 0);
    await input.onProgress?.({ stage: 'start', completedMessages: compressedMessages,
      totalMessages: compressedMessages + waveMessageCount, beforeTokens, afterTokens: packet.manifest.estimatedTokensAfter,
      parallelBatchCount: candidates.length }, packet.messages);
    const sourceWindow = active;
    const sourceWindowTokens = packet.manifest.estimatedTokensAfter;
    const outcomes = await Promise.all(candidates.map(async (batch) => {
      try {
        const candidate = await summarizeContextBatch({ currentRequest: pinnedUser, messages: batch.messages,
          maximumInputTokens, generate: input.generateSummary, onRetry: input.onSummaryRetry, abortSignal: input.abortSignal,
          validate: (message) => {
            const replacement = [...sourceWindow.slice(0, batch.start), message, ...sourceWindow.slice(batch.end)];
            if (assembleRuntimeContext({ ...input, messages: replacement, pinnedUser, observations }).manifest.estimatedTokensAfter >= sourceWindowTokens) {
              throw new ContextSummaryError('Handoff did not reduce the context window. Summarize more concisely without copying source payloads.');
            }
          } });
        return { batch, candidate } as const;
      } catch (error) {
        return { batch, error } as const;
      }
    }));
    input.abortSignal?.throwIfAborted();
    let removedBefore = 0;
    // Model calls above are independent. Checkpoints below stay serial and in
    // source order so a crash always leaves a valid chronological transcript.
    for (const outcome of outcomes.sort((left, right) => left.batch.start - right.batch.start)) {
      if (packet.manifest.estimatedTokensAfter <= input.compressionTargetTokens) break;
      const { batch } = outcome;
      if ('error' in outcome) {
        const error = outcome.error;
        const failure = error instanceof ContextSummaryError ? error
          : new ContextSummaryError(error instanceof Error ? error.message : String(error), { cause: error });
        // A provider error or invalid generated handoff can succeed on a later
        // step. Only cache a deterministic input-size rejection across steps.
        if (failure.details?.code === 'input-limit') input.failedCompactions?.set(batch.key, failure);
        rejectedBatchKeys.add(batch.key);
        lastCompactionError = failure;
        compactionFailure = failure.message;
        compactionFailureDetails = failure.details;
        continue;
      }
      const { candidate } = outcome;
      const start = batch.start - removedBefore;
      const end = batch.end - removedBefore;
      const replacement = [...active.slice(0, start), candidate.message, ...active.slice(end)];
      const nextPacket = assembleRuntimeContext({ ...input, messages: replacement, pinnedUser, observations });
      if (nextPacket.manifest.estimatedTokensAfter >= packet.manifest.estimatedTokensAfter) {
        const failure = new ContextSummaryError('Handoff did not reduce the current context window. Original batch preserved.', {
          details: { code: 'invalid-handoff', reason: 'parallel-commit' },
        });
        rejectedBatchKeys.add(batch.key);
        lastCompactionError = failure;
        compactionFailure = failure.message;
        compactionFailureDetails = failure.details;
        continue;
      }
      const nextState = { version: 3 as const, epoch: state.epoch + 1, handoffRef: candidate.segment.ref,
        pinnedUserRef: pinnedUser ? runtimeContextMessageRef(pinnedUser) : undefined };
      // Commit the complete replacement and audit evidence before publishing it in memory.
      await input.onCheckpoint?.({ messages: nextPacket.messages, activeMessages: replacement,
        continuationSummary: JSON.stringify(nextState), removedIndexes: [],
        compressedMessages: compressedMessages + batch.messages.length, segmentRecords: [...sourceFileReceipts, candidate.message] });
      active = replacement; state = nextState; compressedMessages += batch.messages.length;
      segmentRecords.push(candidate.message);
      createdHandoffs.add(runtimeContextMessageRef(candidate.message));
      removedBefore += batch.messages.length - 1;
      packet = build();
      await input.onProgress?.({ stage: 'batch', completedMessages: compressedMessages,
        totalMessages: compressedMessages, beforeTokens, afterTokens: packet.manifest.estimatedTokensAfter }, packet.messages);
    }
    if (packet.manifest.estimatedTokensAfter <= input.compressionTargetTokens) break;
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
  if (packet.manifest.estimatedTokensAfter <= input.compressionTargetTokens) {
    compactionFailure = undefined;
    compactionFailureDetails = undefined;
    compactionStopReason = undefined;
  }
  if (packet.manifest.estimatedTokensAfter > input.inputBudgetTokens) throw new ContextSummaryError('Context capacity exceeded. Original user instructions, loaded Skills and latest image were preserved; no model request was sent.', {
    details: { code: 'input-capacity-exceeded', compactionStopReason, estimatedTokens: packet.manifest.estimatedTokensAfter,
      inputBudgetTokens: input.inputBudgetTokens, lastCompactionFailure: lastCompactionError?.message,
      lastCompactionFailureDetails: lastCompactionError?.details },
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

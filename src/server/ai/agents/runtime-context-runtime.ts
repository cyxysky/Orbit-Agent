import { randomUUID } from 'node:crypto';
import type { ModelMessage } from 'ai';
import { jsonRecordFromUnknown, jsonValueFromString } from '@cjfclonedeep/capability-sdk';
import { assembleRuntimeContext, runtimeContextMessageRef, type RuntimeContextInput, type ContextCompressionProgress } from './runtime-context-assembler';
import { contextSummaryInputTokens, contextSegmentMarker, historicalContextHandoff, summarizeContextBatch, parseContextSummary, ContextSummaryError, type ContextSummaryGenerator, type ContextSummaryRetry } from './runtime-semantic-summary';
import { isOriginalBrowserChatUserMessage } from './browser-chat-model-context';
import { skillBodyKeysForPreservation } from './hidden-runtime-skills';
import { hasSourceFileReceipt, prepareRuntimeSourceFiles } from './runtime-source-files';
import { subagentModelMessages } from './browser-chat-subagent-delivery';
import { estimateRuntimeMessageContext } from './runtime-context-budget';

type Checkpoint = { system: string; messages: ModelMessage[]; activeMessages: ModelMessage[]; continuationSummary: string; removedIndexes: number[]; compressedMessages: number; segmentRecords: ModelMessage[] };

function separateRuntimeSkillReceipts(messages: ModelMessage[], protectedToolCallIds?: ReadonlySet<string>) {
  const receipts: Array<{ skillId: string; content: string; index: number }> = [];
  const projected = messages.map((message, index) => {
    if (message.role !== 'tool') return message;
    let changed = false;
    const content = message.content.map(part => {
      if (part.type !== 'tool-result' || protectedToolCallIds?.has(part.toolCallId)
        || !('value' in part.output)) return part;
      const result = jsonRecordFromUnknown(jsonValueFromString(part.output.value));
      const receipt = jsonRecordFromUnknown(result?.runtimeSkill);
      if (!result || receipt?.readSatisfied !== true || typeof receipt.skillId !== 'string'
        || typeof receipt.content !== 'string' || !receipt.content.trim()) return part;
      receipts.push({ skillId: receipt.skillId, content: receipt.content, index });
      const value = { ...result };
      delete value.runtimeSkill;
      changed = true;
      return { ...part, output: { type: 'json' as const, value: JSON.parse(JSON.stringify(value)) } };
    });
    return changed ? { ...message, content } : message;
  });
  if (!receipts.length) return messages;
  const retainedBodies = skillBodyKeysForPreservation(projected);
  const insertions = new Map<number, ModelMessage[]>();
  for (const receipt of receipts) {
    const toolCallId = `call_skill_${runtimeContextMessageRef({ role: 'assistant', content: JSON.stringify({
      skillId: receipt.skillId, content: receipt.content,
    }) }).slice(-32)}`;
    // Preserve the exact manual independently of the tool's business payload.
    // Otherwise a Skill attached to a novel result pins the entire outline,
    // tool arguments and reasoning forever, even after subsequent revisions.
    const exchange: ModelMessage[] = [
      { role: 'assistant', content: [{ type: 'tool-call', toolName: 'skill', toolCallId,
        input: { action: 'read', skillId: receipt.skillId, reason: 'Retain the runtime Skill already supplied with the tool result.' } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolName: 'skill', toolCallId,
        output: { type: 'json', value: { ok: true, actual: receipt.content } } }] },
    ];
    const bodyKeys = skillBodyKeysForPreservation(exchange);
    if ([...bodyKeys].every(key => retainedBodies.has(key))) continue;
    // Keep different Skill versions in their original chronological positions,
    // and never insert an assistant message between sibling tool results.
    let end = receipt.index;
    while (projected[end + 1]?.role === 'tool') end++;
    insertions.set(end, [...(insertions.get(end) || []), ...exchange]);
    for (const key of bodyKeys) retainedBodies.add(key);
  }
  return projected.flatMap((message, index) => [message, ...(insertions.get(index) || [])]);
}

/** Owns compaction and persistence; the assembler remains a deterministic projection. */
export async function prepareRuntimeContext(input: RuntimeContextInput & {
  continuationSummary: string; compressionTriggerTokens: number; compressionTargetTokens: number;
  sourceRecords?: Record<string, ModelMessage>;
  generateSummary: ContextSummaryGenerator;
  onSummaryRetry?: (retry: ContextSummaryRetry) => void | Promise<void>;
  failedCompactions?: Map<string, ContextSummaryError>;
  protectedToolCallIds?: ReadonlySet<string>;
  abortSignal?: AbortSignal;
  refreshObservations?: () => Promise<ModelMessage[]>;
  onProgress?: (progress: ContextCompressionProgress, messages: ModelMessage[], system: string) => void | Promise<void>;
  onCheckpoint?: (checkpoint: Checkpoint) => void | Promise<void>;
}) {
  // Keep original child receipts archived while removing legacy automatic-delivery
  // instructions. Synchronous spawn and explicit reads retain their full content.
  const subagentArchives = input.messages.filter(message => message.role === 'tool'
    && message.content.some(part => part.type === 'tool-result' && part.toolName === 'subagent'));
  input = { ...input, messages: subagentModelMessages(input.messages) };
  const fileSourceRecords = { ...input.sourceRecords };
  const fileQuery = JSON.stringify([input.pinnedUser?.content || input.messages[input.currentUserIndex]?.content,
    input.messages.filter(message => message.role === 'assistant').slice(-3).map(message => message.content)]);
  const baseKnowledge = input.knowledge;
  const projectFiles = (messages: ModelMessage[]) => prepareRuntimeSourceFiles({ messages, records: fileSourceRecords,
    inputBudgetTokens: input.inputBudgetTokens, query: fileQuery });
  for (const message of input.messages) fileSourceRecords[runtimeContextMessageRef(message)] = message;
  let files = projectFiles(input.messages);
  input = { ...input, knowledge: [...baseKnowledge, ...files.knowledge] };
  const sourceFileReceipts = [...subagentArchives, ...files.archiveRecords, ...files.messages.filter(hasSourceFileReceipt)];
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
  const projectReplacement = (messages: ModelMessage[]) => {
    // File bodies can move from active receipts into historical retrieval only
    // when their exchanges are compacted. Rebuild the index and budget for the
    // replacement so includedRanges never describe bodies that were removed.
    const files = projectFiles(messages);
    const knowledge = [...baseKnowledge, ...files.knowledge];
    const packet = assembleRuntimeContext({ ...input, messages: files.messages, knowledge, pinnedUser, observations });
    packet.manifest.sourceFiles = files.stats;
    return { files, knowledge, packet };
  };
  let packet = build();
  const beforeTokens = packet.manifest.estimatedTokensAfter;
  const compressionRequested = beforeTokens > input.compressionTriggerTokens;
  if (compressionRequested) {
    const projected = separateRuntimeSkillReceipts(active, input.protectedToolCallIds);
    if (projected !== active) {
      sourceFileReceipts.push(...active);
      active = projected;
      packet = build();
    }
  }
  let compressedMessages = 0;
  const segmentRecords: ModelMessage[] = [...sourceFileReceipts];
  let compactionFailure: string | undefined;
  let compactionFailureDetails: Record<string, unknown> | undefined;
  let compactionStopReason: { code: string; message: string } | undefined;
  let attemptedCompaction = false;
  let lastCompactionError: ContextSummaryError | undefined;
  const rejectedBatchKeys = new Set<string>();
  const configuredKeepRecent = Number(process.env.AI_CONTEXT_KEEP_RECENT_BLOCKS);
  const keepRecent = Number.isFinite(configuredKeepRecent) ? Math.max(1, Math.floor(configuredKeepRecent)) : 4;
  const maximumInputTokens = input.inputBudgetTokens;
  let waveCount = 0;
  let completedBatchCount = 0;
  let maximumParallelBatches = 0;
  let retainedRecentTokens = 0;
  while (compressionRequested && packet.manifest.estimatedTokensAfter > input.compressionTargetTokens) {
    for (const message of [...sourceFileReceipts, ...active]) fileSourceRecords[runtimeContextMessageRef(message)] = message;
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
    // Keep the latest real exchange intact so a just-completed tool result is
    // delivered in full. Additional recent exchanges share a token budget;
    // four enormous outline revisions must not become an unbounded floor.
    const recentBlocks = new Set<typeof blocks[number]>();
    retainedRecentTokens = 0;
    for (const block of [...blocks].reverse()) {
      if (protectedSkillBlocks.has(block.messages) || block.messages.every(message => message.role === 'user')) continue;
      const tokens = estimateRuntimeMessageContext(block.messages).totalTokens;
      if (recentBlocks.size && (recentBlocks.size >= keepRecent
        || retainedRecentTokens + tokens > input.compressionTargetTokens * 0.25)) break;
      recentBlocks.add(block);
      retainedRecentTokens += tokens;
    }
    const batchInputTarget = Math.min(64000, Math.max(8000, Math.ceil(
      (packet.manifest.estimatedTokensAfter - retainedRecentTokens) / 4)));
    type SourceBatch = { start: number; end: number; messages: ModelMessage[]; removeIndexes: number[]; sourceTokens: number; key: string };
    const batches: SourceBatch[] = [];
    let pending: { start: number; end: number; messages: ModelMessage[]; removeIndexes: number[] } | undefined;
    const replaceBatch = (window: ModelMessage[], batch: SourceBatch, handoff: ModelMessage) => {
      const removed = new Set(batch.removeIndexes);
      // Exact user instructions stay in order. Place the handoff AFTER its last
      // source, so an observation never moves ahead of an intervening correction.
      return window.flatMap((message, index) => [
        ...(!removed.has(index) ? [message] : []), ...(index === batch.end - 1 ? [handoff] : []),
      ]);
    };
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
    for (const block of blocks) {
      const messages = block.messages;
      const calls = messages.flatMap(message => message.role === 'assistant' && Array.isArray(message.content) ? message.content.filter(part => part.type === 'tool-call').map(part => part.toolCallId) : []);
      const results = new Set(messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(part => part.type === 'tool-result').map(part => part.toolCallId) : []));
      const incomplete = messages[0]?.role === 'tool' || calls.some(id => !results.has(id));
      const userAnchor = messages.some(message => isOriginalBrowserChatUserMessage(message)
        || (pinnedRef && runtimeContextMessageRef(message) === pinnedRef));
      const protectedBlock = protectedSkillBlocks.has(messages)
        || messages.some(message => Array.isArray(message.content) && message.content.some(part => (
          (part.type === 'tool-call' || part.type === 'tool-result') && input.protectedToolCallIds?.has(part.toolCallId)
        )));
      if (incomplete || protectedBlock || recentBlocks.has(block)) {
        flush();
        if (incomplete) incompleteBlocks++;
        continue;
      }
      // User text is an exact chronological anchor, not a batch boundary. The
      // old split-at-every-user strategy produced dozens of competing handoffs.
      if (userAnchor) continue;
      const proposed = pending ? active.slice(pending.start, block.end) : messages;
      if (contextSummaryInputTokens(pinnedUser, proposed) > Math.min(batchInputTarget, maximumInputTokens)) {
        flush();
        if (contextSummaryInputTokens(pinnedUser, messages) > maximumInputTokens) {
          oversizedBlocks++;
          continue;
        }
      }
      const indexes = Array.from({ length: block.end - block.start }, (_, index) => block.start + index);
      if (!pending) pending = { start: block.start, end: block.end, messages: [...messages], removeIndexes: indexes };
      else { pending.end = block.end; pending.messages = active.slice(pending.start, block.end); pending.removeIndexes.push(...indexes); }
    }
    flush();
    // A short isolated exchange can cost more as a handoff once its source
    // references are included. Prefer substantial batches, including earlier
    // handoffs, and keep searching after one batch fails validation.
    const eligible = batches.filter(batch => batch.sourceTokens >= Math.max(600, batch.messages.length * 75))
      .map(batch => {
        const emptyHandoff = historicalContextHandoff(batch.messages, '').message;
        const replacement = replaceBatch(active, batch, emptyHandoff);
        const fixedCost = projectReplacement(replacement).packet.manifest.estimatedTokensAfter;
        const maximumSummaryTokens = Math.floor(packet.manifest.estimatedTokensAfter - fixedCost - 128);
        // Brevity is a generation target, not a reason to throw away a useful
        // reduction. Accept a complete summary that fits the replacement's real
        // budget, then compact it again if the window still exceeds its target.
        return { ...batch, maximumSummaryTokens, targetSummaryTokens: Math.floor(Math.min(
          maximumSummaryTokens, Math.max(400, batch.sourceTokens * 0.12), 4000)) };
      })
      // The source references and envelope can cost most of an isolated exchange.
      // Do not call the model when there is too little room for a useful handoff.
      .filter(batch => batch.maximumSummaryTokens >= 400);
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
    waveCount++;
    maximumParallelBatches = Math.max(maximumParallelBatches, candidates.length);
    const waveMessageCount = candidates.reduce((count, candidate) => count + candidate.removeIndexes.length, 0);
    const waveTotalMessages = compressedMessages + waveMessageCount;
    await input.onProgress?.({ stage: 'start', completedMessages: compressedMessages,
      totalMessages: waveTotalMessages, beforeTokens, afterTokens: packet.manifest.estimatedTokensAfter,
      parallelBatchCount: candidates.length, wave: waveCount }, packet.messages, packet.system);
    const sourceWindow = active;
    const sourceWindowTokens = packet.manifest.estimatedTokensAfter;
    const pendingSummaries = new Map(candidates.map(batch => [batch.key, (async () => {
      try {
        const candidate = await summarizeContextBatch({ currentRequest: pinnedUser, messages: batch.messages,
          maximumInputTokens, maximumSummaryTokens: batch.maximumSummaryTokens, targetSummaryTokens: batch.targetSummaryTokens,
          generate: input.generateSummary, onRetry: input.onSummaryRetry, abortSignal: input.abortSignal,
          validate: (message) => {
            const replacement = replaceBatch(sourceWindow, batch, message);
            if (projectReplacement(replacement).packet.manifest.estimatedTokensAfter >= sourceWindowTokens) {
              throw new ContextSummaryError('Handoff did not reduce the context window. Summarize more concisely without copying source payloads.');
            }
          } });
        return { batch, candidate } as const;
      } catch (error) {
        return { batch, error } as const;
      }
    })()]));
    const committed: Array<{ batch: SourceBatch; message: ModelMessage }> = [];
    // Commit each completed result immediately, without waiting for a slow
    // sibling. Rebuild from immutable source indexes so out-of-order completion
    // cannot replace the wrong messages. Drain every already-started request.
    while (pendingSummaries.size) {
      const outcome = await Promise.race(pendingSummaries.values());
      pendingSummaries.delete(outcome.batch.key);
      input.abortSignal?.throwIfAborted();
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
      const nextCommitted = [...committed, { batch, message: candidate.message }];
      const removed = new Set(nextCommitted.flatMap(item => item.batch.removeIndexes));
      const insertions = new Map(nextCommitted.map(item => [item.batch.end - 1, item.message]));
      const replacement = sourceWindow.flatMap((message, index) => [
        ...(!removed.has(index) ? [message] : []), ...(insertions.has(index) ? [insertions.get(index)!] : []),
      ]);
      const projection = projectReplacement(replacement);
      const nextPacket = projection.packet;
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
      const projectedFileRecords = [...projection.files.archiveRecords, ...projection.files.messages.filter(hasSourceFileReceipt)];
      await input.onCheckpoint?.({ system: nextPacket.system, messages: nextPacket.messages, activeMessages: projection.files.messages,
        continuationSummary: JSON.stringify(nextState), removedIndexes: [],
        compressedMessages: compressedMessages + batch.removeIndexes.length,
        // Projection can create new receipts (for example after separating a
        // child result from its Skill). Archive the exact handoff sources too;
        // the original tool output alone does not satisfy these references.
        segmentRecords: [...sourceFileReceipts, ...batch.messages, ...projectedFileRecords, candidate.message] });
      files = projection.files;
      input = { ...input, knowledge: projection.knowledge };
      active = files.messages; state = nextState; compressedMessages += batch.removeIndexes.length;
      sourceFileReceipts.push(...projectedFileRecords);
      committed.push({ batch, message: candidate.message });
      completedBatchCount++;
      segmentRecords.push(...batch.messages, ...projectedFileRecords, candidate.message);
      packet = build();
      await input.onProgress?.({ stage: 'batch', completedMessages: compressedMessages,
        totalMessages: waveTotalMessages,
        beforeTokens, afterTokens: packet.manifest.estimatedTokensAfter, wave: waveCount,
        parallelBatchCount: candidates.length, completedBatchCount }, packet.messages, packet.system);
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
  if (attemptedCompaction) packet.manifest.compression = {
    waveCount, completedBatchCount, maximumParallelBatches, retainedRecentTokens,
    targetTokens: input.compressionTargetTokens, targetReached: packet.manifest.estimatedTokensAfter <= input.compressionTargetTokens,
  };
  packet.manifest.estimatedTokensBefore = beforeTokens;
  packet.manifest.summaryMessageCount = compressedMessages;
  return { ...packet, activeMessages: active, continuationSummary: JSON.stringify(state), compressedMessages, segmentRecords, removedIndexes: [] as number[] };
}

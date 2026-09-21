import { randomUUID } from 'node:crypto';
import type { ModelMessage } from 'ai';
import { assembleRuntimeContext, runtimeContextMessageRef, type RuntimeContextInput, type ContextCompressionProgress } from './runtime-context-assembler';
import { contextSummaryRecord, summarizeContextBatch, parseContextSummary, ContextSummaryError } from './runtime-semantic-summary';
import { estimateRuntimeMessageContext } from './runtime-context-budget';

type Checkpoint = { messages: ModelMessage[]; activeMessages: ModelMessage[]; continuationSummary: string; removedIndexes: number[]; compressedMessages: number; segmentRecords: ModelMessage[] };
/** Owns compaction and persistence; the assembler remains a deterministic projection. */
export async function prepareRuntimeContext(input: RuntimeContextInput & {
  continuationSummary: string; compressionTriggerTokens: number; compressionTargetTokens: number;
  generateSummary: (prompt: string, maxOutputTokens: number) => Promise<string>;
  abortSignal?: AbortSignal;
  refreshObservations?: () => Promise<ModelMessage[]>;
  onProgress?: (progress: ContextCompressionProgress, messages: ModelMessage[]) => void | Promise<void>;
  onCheckpoint?: (checkpoint: Checkpoint) => void | Promise<void>;
}) {
  let active = [...input.messages];
  let state = parseContextSummary(input.continuationSummary) || { version: 3 as const, epoch: 0 };
  let observations = input.observations;
  const pinnedUser = input.pinnedUser || input.messages[input.currentUserIndex];
  const build = () => assembleRuntimeContext({ ...input, messages: active, pinnedUser, observations });
  let packet = build();
  const beforeTokens = packet.manifest.estimatedTokensAfter;
  let compressedMessages = 0;
  const segmentRecords: ModelMessage[] = [];
  let compactionFailure: string | undefined;
  let attemptedCompaction = false;
  const keepRecent = Math.max(4, Number(process.env.AI_CONTEXT_KEEP_RECENT_BLOCKS) || 4);
  const maxOutputTokens = Math.min(3000, Math.max(256, Math.floor(input.inputBudgetTokens * 0.06)));
  const maximumInputTokens = Math.min(18000, input.inputBudgetTokens - maxOutputTokens);
  for (let attempt = 0; packet.manifest.estimatedTokensAfter > input.compressionTriggerTokens && attempt < 8; attempt++) {
    const blocks: ModelMessage[][] = [];
    for (let start = 0; start < active.length;) {
      let end = start + 1;
      if (active[start].role === 'assistant') while (active[end]?.role === 'tool') end++;
      blocks.push(active.slice(start, end)); start = end;
    }
    const source: ModelMessage[] = [];
    let cost = 1024 + estimateRuntimeMessageContext(pinnedUser).totalTokens;
    for (const block of blocks.slice(0, Math.max(0, blocks.length - keepRecent))) {
      const calls = block.flatMap(message => message.role === 'assistant' && Array.isArray(message.content) ? message.content.filter(part => part.type === 'tool-call').map(part => part.toolCallId) : []);
      const results = new Set(block.flatMap(message => message.role === 'tool' ? message.content.filter(part => part.type === 'tool-result').map(part => part.toolCallId) : []));
      if (calls.some(id => !results.has(id))) break;
      const next = estimateRuntimeMessageContext(block.map(contextSummaryRecord)).totalTokens;
      if (cost + next > maximumInputTokens) break;
      source.push(...block); cost += next;
    }
    if (source.length < 2) break;
    attemptedCompaction = true;
    await input.onProgress?.({ stage: 'start', completedMessages: compressedMessages, totalMessages: source.length, beforeTokens, afterTokens: packet.manifest.estimatedTokensAfter }, packet.messages);
    let candidate: Awaited<ReturnType<typeof summarizeContextBatch>>;
    try {
      candidate = await summarizeContextBatch({ currentRequest: pinnedUser, messages: source, maxOutputTokens, maximumInputTokens, generate: input.generateSummary, abortSignal: input.abortSignal });
      const replacement = [candidate.message, ...active.slice(source.length)];
      if (estimateRuntimeMessageContext(replacement).totalTokens >= estimateRuntimeMessageContext(active).totalTokens
        || estimateRuntimeMessageContext(candidate.message).totalTokens > maxOutputTokens + 1024) throw new ContextSummaryError('Handoff did not reduce the window within budget.');
    } catch (error) {
      input.abortSignal?.throwIfAborted();
      compactionFailure = error instanceof Error ? error.message : String(error);
      if (packet.manifest.estimatedTokensAfter > input.inputBudgetTokens) throw error;
      break;
    }
    const replacement = [candidate.message, ...active.slice(source.length)];
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
  // Summary generation (including a failed, best-effort attempt) can outlive a
  // screenshot's action window. Refresh after ALL batches, before model dispatch;
  // refreshing only successful batches leaves the fallback path using stale IDs.
  if (attemptedCompaction && input.refreshObservations) {
    input.abortSignal?.throwIfAborted();
    observations = await input.refreshObservations();
    packet = build();
  }
  if (packet.manifest.estimatedTokensAfter > input.inputBudgetTokens) throw new ContextSummaryError('Context budget exceeded. Current request, required constraints and latest image were preserved; no model request was sent.');
  packet.manifest.id = `ctxreq_${randomUUID()}`;
  packet.manifest.createdAt = new Date().toISOString();
  packet.manifest.epoch = state.epoch;
  packet.manifest.compactionFailure = compactionFailure;
  packet.manifest.estimatedTokensBefore = beforeTokens;
  packet.manifest.summaryMessageCount = compressedMessages;
  return { ...packet, activeMessages: active, continuationSummary: JSON.stringify(state), compressedMessages, segmentRecords, removedIndexes: [] as number[] };
}

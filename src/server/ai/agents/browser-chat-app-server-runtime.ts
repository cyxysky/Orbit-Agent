import { runtimeConfiguration } from '@/server/settings/runtime-configuration';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { asSchema } from '@ai-sdk/provider-utils';
import { parsePartialJson, type ModelMessage, type ToolSet } from 'ai';
import { markdownBlock } from '@cjfclonedeep/capability-sdk/responses';
import { ResponseSession, type StructuredResponse } from '@cjfclonedeep/capability-sdk';
import { getModelSettings } from '@/server/ai/model';
import { aiReasoningEffort } from '@/server/ai/ai-sdk-runtime';
import { CODEX_HOST_APPROVAL_POLICY, openCodexAppServer, readCodexThreadTools, updateCodexThreadTools, type CodexDynamicTool, type CodexInput, type CodexRecord, type CodexToolOutput, type CodexToolCall } from '@/server/ai/codex-app-server';
import { codexRuntimeError } from '@/server/ai/codex-runtime-errors';
import { responseRegistry } from '@/lib/response-registry';
import { browserChatHasPendingHumanInput, browserChatRequestedUserInput } from '@/lib/browser-chat-tools';
import { browserChatFinalBlocksToText, type BrowserChatFinalBlock } from '@/lib/browser-chat-ui-message';
import { repairFileArtifactDownloadLinks } from '@/server/capabilities/browser-chat-file-links';
import { browserChatCapabilityResult } from '@/lib/browser-chat-capability-result';
import { currentRuntimeTimePromptLine } from '@/server/ai/prompts/runtime-agent.prompt';
import { effectiveDisabledCapabilityTools } from './runtime-tool-catalog';
import { isRuntimeToolEnabled } from '@/server/runtime/self-bootstrap-policy';
import { hiddenRuntimeSkillIdsInModelContext } from './hidden-runtime-skills';
import { createRuntimeContextReadTool, runtimeContextMessageRef, type RuntimeContextManifest } from './runtime-context-assembler';
import { serializableBrowserChatModelMessages } from './browser-chat-model-context';
import { completeRuntimeModelToolChain } from './runtime-context-compression';
import { calibrateRuntimeRequestContext, runtimeProviderInputTokens, scaleRuntimeRequestContextEstimate, type RuntimeRequestContextStats } from './runtime-context-budget';
import { readScreenshotForAi } from './browser-chat-image-input';
import { runtimeKnowledgeMessage } from './runtime-knowledge-context';
import { RuntimeExecutionJournal } from './runtime-execution-journal';
import { readCodexRuntimeBinding, writeCodexRuntimeBinding } from './codex-runtime-state';
import { browserInteractionInstructions } from './runtime-browser-interaction';
import { normalizeBrowserChatInteractionMode } from '@/lib/browser-chat-interaction-mode';
import { summarizeRuntimeLogTimings } from './runtime-log-timings';
import type { InteractiveBrowserTurnResult, executeInteractiveBrowserTurn } from './browser-chat-executor.agent';
import type { BrowserActionResult } from '@cjfclonedeep/capability-sdk/browser/node';
import type { StepExecutionResult, StepToolCall, AiRequestSnapshot, AiToolContextSnapshot } from '@/server/ai/schemas/runtime.schema';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';
import { modelVisibleText, containsModelToolProtocol } from '@/lib/model-visible-text';
import { executionStatusText } from '@/lib/execution-log-presentation';
import { browserChatOutputPerformanceFromUnknown } from '@/lib/browser-chat-activity';


type Input = Parameters<typeof executeInteractiveBrowserTurn>[0];
type Trace = { id?: string; name: string; input: unknown; result?: BrowserActionResult; startedAt?: number; completedAt?: number;
  invalid?: boolean; elapsedMs?: number; actionElapsedMs?: number; progress?: StepToolCall['progress'];
  contextBefore?: AiToolContextSnapshot; contextAfter?: AiToolContextSnapshot; aiRequestElapsedMs?: number;
  executionError?: { name: string; message: string; stack?: string } };
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export type AppServerBrowserHost = {
  prompt: (input: Input, tools: Array<{ name: string; description: string }>) => string;
  tools: (input: Input, options: {
    traces: Trace[]; loadedSkills: Set<string>; onTrace: (trace: Trace) => Promise<void>;
    archiveResult: (name: string, id: string, result: BrowserActionResult) => Promise<string>;
    validateFinalResponse: (response: StructuredResponse) => Promise<string | undefined>;
    onImage: (image: { path: string; source: string; label?: string }) => void;
    getCredentials: () => Input['credentialBindings'];
    aiRequest: AiRequestSnapshot;
    getAiRequestElapsedMs: () => number | undefined;
    visualContext: unknown;
    onVisualContextChange: (value: unknown) => Promise<void>;
  }) => Promise<{ tools: ToolSet; dispose: () => void | Promise<void> }>;
  approve: (name: string, args: unknown) => Promise<boolean>;
  summarizeTraces: (traces: Trace[]) => StepToolCall[];
  humanPause: (traces: Trace[]) => string | undefined;
  validateFinalResponse: (response: StructuredResponse) => string | undefined;
};

/** UI/evidence adapter only. Model history and normal tool iterations live in Codex. */
export async function executeAppServerBrowserTurn(input: Input, host: AppServerBrowserHost): Promise<InteractiveBrowserTurnResult> {
  const scope = input.contextScope || 'main';
  const sessionId = input.sessionId || input.runId;
  const settings = getModelSettings();
  const assertActive = () => { input.abortSignal?.throwIfAborted(); if (input.shouldContinue && !input.shouldContinue()) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Browser chat turn is no longer active.'); };
  assertActive();
  const steps = [...(input.completedSteps || [])];
  const newSteps: StepExecutionResult[] = [];
  const traces: Trace[] = [];
  const records = { ...input.contextRecords };
  const transcript: ModelMessage[] = [];
  const loadedSkills = new Set<string>();
  const images: Array<{ path: string; source: string; label?: string }> = [];
  const stepIndex = Math.max(input.initialStepIndex || 0, ...steps.map(step => step.index), 0) + 1;
  let credentials = input.credentialBindings;
  let accepted: StructuredResponse | undefined;
  let pauseRequested = false;
  let binding = await readCodexRuntimeBinding(sessionId, scope, input.userId);
  let requestStats = binding?.contextUsage;
  let modelRequestElapsedMs: number | undefined;
  let nativeUsageSignature = '';
  const journal = new RuntimeExecutionJournal(input.runId, input.contextScope);
  const recovered = [...await journal.recover(), ...Object.values(binding?.pendingDeliveries || {}).flat()];
  let visualContext = journal.state.observations as StepExecutionResult['visualContext'];
  const userMessage: ModelMessage = { role: 'user', content: input.modelInstruction || input.instruction };
  transcript.push(userMessage);
  const aiRequest: AiRequestSnapshot = { id: randomUUID(), kind: 'runtime', stepIndex, createdAt: new Date().toISOString(),
    provider: settings.provider, model: settings.model, imageAttached: Boolean(input.referenceImagePaths?.length),
    messages: [{ role: 'user', content: [{ type: 'text', text: input.modelInstruction || input.instruction }] }],
    options: { engine: 'codex-app-server' } };
  let modelRequestMessageCount = 0;
  let activeTurnId = '';
  const items = new Map<string, { index: number; value: CodexRecord; startedAt: number; completed: boolean }>();
  const textById = new Map<string, string>();
  const loggedTraceStarts = new Set<string>();
  const loggedTraceProgress = new Map<string, string>();
  const itemState = (item: CodexRecord) => {
    const id = String(item.id);
    let state = items.get(id);
    if (!state) { state = { index: items.size + 1, value: item, startedAt: Date.now(), completed: false }; items.set(id, state); }
    else state.value = { ...state.value, ...item };
    return state;
  };
  const debug = async (phase: string, message: string, details: ObjectValue, toolCallId?: string) => {
    await input.onDebug?.({ phase, message, stepIndex, details: { __browserChatFullLogDetails: true, value: {
      engine: 'codex-app-server', threadId: binding?.threadId, codexTurnId: activeTurnId, ...details },
      execution: { turnId: input.turnId || input.runId, attemptId: aiRequest.id, toolCallId } } });
  };
  const publishOutput = async (item: CodexRecord, completed = false) => {
    const state = itemState(item);
    const content: ObjectValue[] = [];
    const id = String(item.id);
    const trace = traces.find(trace => trace.id === id);
    if (item.type === 'agentMessage') content.push({ type: 'text', text: modelVisibleText(String(item.text || textById.get(id) || ''), !completed) });
    if (item.type === 'reasoning') {
      const summary = list(item.summary).map(value => typeof value === 'string' ? value : String(object(value).text || ''));
      const streamed = [...textById].filter(([key]) => key.startsWith(`reasoning:${id}:`)).map(([, text]) => text);
      for (const text of summary.length ? summary : streamed) content.push({ type: 'reasoning', text: modelVisibleText(text, !completed) });
    }
    if (item.type === 'dynamicToolCall') {
      content.push({ type: 'tool-call', toolCallId: id, toolName: item.tool, input: trace?.input ?? item.arguments,
        invalid: trace?.invalid, error: object(trace?.result?.data).error });
      if (trace?.result) content.push({ type: 'tool-result', toolCallId: id, output: trace.result });
    }
    if (!content.length) return;
    const elapsedMs = Date.now() - state.startedAt;
    // Only the terminal snapshot contributes timings; progress snapshots update the same UI cycle.
    const timings = completed && !state.completed ? summarizeRuntimeLogTimings({
      totalElapsedMs: elapsedMs, aiElapsedMs: item.type === 'dynamicToolCall' || settings.provider !== 'codex' ? 0 : elapsedMs,
      traces: trace ? [trace] : [],
    }) : undefined;
    state.completed ||= completed;
    await debug('ai:runtime:response', item.type === 'dynamicToolCall' ? `${item.tool} 工具${completed ? '已结束' : '已请求'}`
      : modelVisibleText(String(item.text || '模型思考记录')).slice(0, 220), { aiRequest, aiOutput: {
      engine: 'codex-app-server', itemId: id, agentStepIndex: state.index, response: { content, phase: item.phase },
      timings, visualContext, finished: completed,
    } }, trace?.id);
  };
  const archive = async (messages: ModelMessage[]) => {
    const added: Record<string, ModelMessage> = {};
    for (const message of serializableBrowserChatModelMessages(messages)) {
      const ref = runtimeContextMessageRef(message);
      if (!records[ref]) added[ref] = message;
    }
    if (Object.keys(added).length) await input.onContextCheckpoint?.({ records: added });
    Object.assign(records, added);
  };
  const publishTranscript = async () => {
    await archive(transcript);
    // Compatibility projection for UI/archive. It is never used to assemble a model request after migration.
    await input.onModelMessages?.({ activeMessages: [...transcript], turnMessages: [...transcript] });
  };
  const publishStep = async (failure?: string) => {
    const tools = host.summarizeTraces(traces);
    const pending = browserChatHasPendingHumanInput(tools);
    const latest = tools.at(-1);
    const step: StepExecutionResult = { index: stepIndex, action: '处理中', expected: input.instruction,
      actual: failure || traces.at(-1)?.result?.actual || '正在处理请求', status: failure ? 'failed' : pending ? 'blocked' : traces.some(trace => !trace.completedAt) ? 'running' : latest?.ok === false ? 'failed' : 'passed',
      tools, aiRequest, visualContext };
    const replace = (target: StepExecutionResult[]) => { const i = target.findIndex(item => item.index === stepIndex); if (i >= 0) target[i] = step; else target.push(step); };
    replace(steps); replace(newSteps);
    await input.onProgress?.(step);
  };
  const publishTrace = async (trace: Trace) => {
    const progress = trace.progress ? JSON.stringify(trace.progress) : undefined;
    const progressChanged = progress !== undefined && loggedTraceProgress.get(trace.id || '') !== progress;
    if (trace.completedAt || (!trace.result && (!loggedTraceStarts.has(trace.id || '') || progressChanged))) {
      if (!trace.completedAt) loggedTraceStarts.add(trace.id || '');
      if (progress !== undefined) loggedTraceProgress.set(trace.id || '', progress);
      await debug('ai:tool', `${trace.name} -> ${trace.completedAt
        ? trace.result?.ok === false ? 'failed' : 'completed' : trace.progress?.message || 'started'}`, { trace, visualContext }, trace.id);
    }
    await publishStep();
  };
  const contextSnapshot = (): AiToolContextSnapshot | undefined => requestStats ? {
    requestId: aiRequest.id, requestCreatedAt: aiRequest.createdAt, ...requestStats,
  } : undefined;
  const publishContextStats = async (inputStats: RuntimeRequestContextStats) => {
    const stats = { ...inputStats, provider: settings.provider, model: settings.model };
    requestStats = stats;
    aiRequest.options = { ...aiRequest.options, modelContextStats: { ...stats, engine: 'codex-app-server' } };
    const snapshot = contextSnapshot();
    for (const trace of traces) {
      let changed = false;
      if (trace.contextBefore?.requestId === aiRequest.id) {
        trace.contextBefore = snapshot;
        if (modelRequestElapsedMs !== undefined) trace.aiRequestElapsedMs = modelRequestElapsedMs;
        changed = true;
      }
      if (trace.contextAfter?.requestId === aiRequest.id) { trace.contextAfter = snapshot; changed = true; }
      else if (trace.completedAt && trace.name !== 'contextCompression' && !trace.contextAfter?.requestId
        && trace.contextBefore?.requestId && trace.contextBefore.requestId !== aiRequest.id) {
        trace.contextAfter = snapshot; changed = true;
      }
      if (changed) await publishTrace(trace);
    }
    if (binding) {
      const manifest: RuntimeContextManifest = { version: 2, id: `ctxreq_${randomUUID()}`, createdAt: aiRequest.createdAt, sessionId,
        engine: 'codex-app-server', threadId: binding.threadId, countKind: stats.actualInputTokens === undefined ? 'heuristic' : 'codex',
        contextWindowTokens: stats.windowTokens || settings.maxContextTokens || 256000,
        estimatedTokensBefore: stats.estimatedTotalTokens, estimatedTokensAfter: stats.estimatedTotalTokens,
        modelContextStats: stats, messageCount: modelRequestMessageCount, summaryMessageCount: 0, knowledge: [],
        model: { provider: settings.provider, model: settings.model } };
      await input.onContextCheckpoint?.({ records: {}, manifest });
      if (JSON.stringify(binding.contextUsage) !== JSON.stringify(stats)) {
        binding.contextUsage = stats; await persistBinding();
      }
    }
    await debug('ai:runtime:context', '模型请求上下文用量已更新', { modelContextStats: aiRequest.options.modelContextStats });
  };
  const mount = await host.tools(input, {
    traces, loadedSkills,
    onTrace: publishTrace,
    archiveResult: async (name, id, result) => {
      const message: ModelMessage = { role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName: name,
        output: { type: 'json', value: safeJson(result) } }] };
      await archive([message]); return runtimeContextMessageRef(message);
    },
    validateFinalResponse: async response => {
      if (browserChatHasPendingHumanInput(host.summarizeTraces(traces))) return 'A human-input request is pending. Wait for its answer before declaring completion.';
      if (traces.some(trace => trace.name !== 'finalResponse' && !trace.completedAt)) return 'Tool calls are still running. Wait for their results before completing the request.';
      const error = host.validateFinalResponse(response);
      if (!error) accepted = response;
      return error;
    },
    onImage: image => { images.push(image); }, getCredentials: () => credentials, aiRequest,
    getAiRequestElapsedMs: () => modelRequestElapsedMs,
    visualContext: journal.state.observations,
    onVisualContextChange: async value => {
      visualContext = value as StepExecutionResult['visualContext'];
      await journal.save('observation', state => { state.observations = value; });
    },
  });
  const disabled = new Set(effectiveDisabledCapabilityTools(input.disabledTools));
  // The model catalogue and dispatch permissions describe the same tool set.
  const definitions: ToolSet = Object.fromEntries(Object.entries({
    ...mount.tools, ...input.memoryTools, contextRead: createRuntimeContextReadTool(() => records),
  }).filter(([name]) => !disabled.has(name) && isRuntimeToolEnabled(name, runtimeConfiguration())));
  let runtime: Awaited<ReturnType<typeof openCodexAppServer>> | undefined;
  let lastText = '';
  let finalText = '';
  let modelFailure: ObjectValue | undefined;
  const seenMessages = new Set<string>();
  const signal = input.abortSignal ?? new AbortController().signal;
  let bindingWrites = Promise.resolve();
  const persistBinding = () => {
    const pending = bindingWrites.then(async () => { if (binding) binding = await writeCodexRuntimeBinding(sessionId, scope, binding); });
    bindingWrites = pending.catch(() => undefined);
    return pending;
  };
  try {
    const schemaTools: CodexDynamicTool[] = await Promise.all(Object.entries(definitions).map(async ([name, definition]) => ({ type: 'function' as const, name,
      description: typeof definition.description === 'function' ? definition.description({ context: undefined }) : definition.description || '',
      inputSchema: await asSchema(definition.inputSchema).jsonSchema })));
    const toolsHash = createHash('sha256').update(JSON.stringify(schemaTools)).digest('hex');
    runtime = await openCodexAppServer({ userId: input.userId, sessionId, scope, hostTools: schemaTools,
      onModelEvent: async event => {
        if (event.phase === 'ai:runtime:stream' && event.details.kind === 'performance') {
          const performance = browserChatOutputPerformanceFromUnknown(event.details.performance);
          if (performance) await input.onTextStream?.({ agentStepIndex: 0, runtimeStepIndex: stepIndex, stepNumber: 0,
            delta: '', text: '', performance });
          return;
        }
        if (event.phase === 'ai:runtime:stream' && event.details.kind === 'tool-input' && event.details.toolName === 'finalResponse') {
          const id = String(event.details.toolCallId || '');
          if (!id) return;
          // The provider call ID is also the host call ID. Publish its row
          // before complete arguments arrive so the draft has a stable owner.
          if (id && !items.has(id)) await publishOutput({ id, type: 'dynamicToolCall', tool: 'finalResponse', arguments: {} });
          const parsed = await parsePartialJson(String(event.details.arguments || ''));
          const blocks = list(object(parsed.value).blocks).flatMap(value => {
            const block = object(value), params = object(block.params);
            return block.type === 'core.markdown' && typeof params.text === 'string'
              ? [{ type: 'core.markdown', params: { text: modelVisibleText(params.text, true) } }] : [];
          });
          await input.onTextStream?.({ agentStepIndex: 0,
            runtimeStepIndex: stepIndex, stepNumber: 0, delta: '', text: '', responseDraft: { id, blocks } });
          return; // Stream deltas are transient UI state, not database log entries.
        }
        if (event.phase === 'ai:runtime:request' && typeof event.details.modelRequestId === 'string') {
          await input.onTextStream?.({ agentStepIndex: 0, runtimeStepIndex: stepIndex, stepNumber: 0,
            delta: '', text: '', responseDraft: null });
          aiRequest.id = event.details.modelRequestId; aiRequest.createdAt = new Date().toISOString();
          modelRequestElapsedMs = undefined;
          const messages = object(event.details.aiInput).messages;
          if (Array.isArray(messages)) modelRequestMessageCount = messages.length;
          if (event.details.aiInputTokens) {
            let stats = event.details.aiInputTokens as RuntimeRequestContextStats;
            if (requestStats?.actualInputTokens !== undefined && requestStats.rawEstimatedTotalTokens
              && requestStats.provider === settings.provider && requestStats.model === settings.model) {
              stats = scaleRuntimeRequestContextEstimate(stats, requestStats.actualInputTokens / requestStats.rawEstimatedTotalTokens);
            }
            event.details.aiInputTokens = stats;
            await publishContextStats(stats);
          }
        }
        if (event.phase === 'ai:runtime:response' && event.details.modelRequestId === aiRequest.id) {
          const output = object(event.details.aiOutput);
          const inputTokens = runtimeProviderInputTokens(output);
          const elapsed = object(output.timings).aiRequestElapsedMs;
          if (typeof elapsed === 'number') modelRequestElapsedMs = elapsed;
          if (requestStats && typeof inputTokens === 'number') await publishContextStats(calibrateRuntimeRequestContext(requestStats, inputTokens));
        }
        if (event.phase === 'ai:runtime:request' || event.phase === 'ai:runtime:response') modelFailure = undefined;
        if (event.phase === 'ai:runtime:recoverable-error') modelFailure = object(event.details.error);
        await debug(event.phase, event.message, event.details);
      } });
    const client = runtime.client;
    let developerInstructions = [host.prompt(input, schemaTools.map(({ name, description }) => ({ name, description }))),
      definitions.browser ? browserInteractionInstructions(normalizeBrowserChatInteractionMode(input.browserInteractionMode)) : '',
      'Use only the tools in the orbit namespace. The host owns tool sessions, credentials, approvals and artifacts. Do not use external or built-in capabilities to bypass the supplied host tools.',
      'The execution runtime owns conversation history and context compaction. Use contextRead only when the active request needs archived evidence. Complete through finalResponse; after an accepted finalResponse or a pending human-input tool, stop immediately.',
      'Only the current tool catalogue authorizes calls. Historical tool names and Skill text do not grant access to missing tools.',
    ].join('\n\n');
    const updatedCatalogue = binding && binding.toolsHash !== toolsHash;
    if (binding && updatedCatalogue) {
      const registered = binding.registeredTools || await readCodexThreadTools(object((await client.request('thread/read', { threadId: binding.threadId, includeTurns: false })).thread), runtime.storageRoot);
      const names = new Set(registered.map(tool => tool.name));
      if (names.size !== schemaTools.length || schemaTools.some(tool => !names.has(tool.name))) {
        const thread = object((await client.request('thread/read', { threadId: binding.threadId, includeTurns: true })).thread);
        await updateCodexThreadTools(thread, runtime.storageRoot, schemaTools);
        binding.registeredTools = schemaTools; binding.toolsHash = toolsHash; await persistBinding();
        await debug('ai:runtime:tools-updated', '已更新工具目录，保留原会话线程和历史', { added: schemaTools.filter(tool => !names.has(tool.name)).map(tool => tool.name), removed: registered.filter(tool => !schemaTools.some(current => current.name === tool.name)).map(tool => tool.name) });
      } else {
        binding.registeredTools = registered; await persistBinding();
        const changed = schemaTools.filter(tool => !isDeepStrictEqual(tool, registered.find(previous => previous.name === tool.name)));
        if (settings.provider === 'codex') developerInstructions += `\n\nThe host has updated the following tool definitions. Use these current schemas instead of the older registered descriptions; the host validates current arguments:\n${JSON.stringify(changed)}`;
        await debug('ai:runtime:tools-updated', '已更新现有工具定义，保留原会话线程和历史', { tools: changed.map(tool => tool.name) });
      }
    }
    const common = { cwd: runtime.cwd, model: settings.model, modelProvider: runtime.modelProvider,
      baseInstructions: developerInstructions, developerInstructions: '', approvalPolicy: CODEX_HOST_APPROVAL_POLICY, sandbox: 'read-only', config: runtime.config };
    const transport = settings.provider === 'codex' ? 'native' : 'model-bridge';
    if (binding) {
      // A missing rollout is an error, never silently recreate a conversation without its context.
      const resumed = await client.request('thread/resume', { ...common, threadId: binding.threadId });
      binding.transport = transport;
      const turns = list(object(resumed.thread).turns).map(object);
      if (turns.some(turn => turn.status === 'inProgress')) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'The saved Codex thread still has an active turn. Stop that turn before resuming.');
      for (const turn of turns) for (const item of list(turn.items).map(object)) {
        if (item.type === 'contextCompaction') loadedSkills.clear();
        if (item.type === 'dynamicToolCall' && item.success === true && item.tool === 'skill') {
          const args = object(item.arguments); if (typeof args.skillId === 'string') loadedSkills.add(args.skillId);
        }
      }
      if (updatedCatalogue) loadedSkills.clear();
    } else {
      const started = await client.request('thread/start', { ...common, dynamicTools: [{ type: 'namespace', name: 'orbit', description: 'Orbit host tools', tools: schemaTools }], ephemeral: false });
      const threadId = String(object(started.thread).id || '');
      if (!threadId) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Codex did not return a persistent thread ID.');
      const migration = completeRuntimeModelToolChain(serializableBrowserChatModelMessages(input.conversation || []));
      binding = { version: 1, revision: 0, userId: input.userId || 'local', threadId, transport, toolsHash, registeredTools: schemaTools,
        pendingMigration: migration.map(messageToResponseItem).flat() };
      await persistBinding();
    }
    // The migration payload stays durable until acknowledged. It contains no executable calls.
    if (binding.pendingMigration?.length) {
      await client.request('thread/inject_items', { threadId: binding.threadId, items: binding.pendingMigration });
      delete binding.pendingMigration; await persistBinding();
    }
    aiRequest.systemPrompt = developerInstructions;
    aiRequest.tools = schemaTools.map(tool => tool.name);
    aiRequest.options = { ...aiRequest.options, threadId: binding.threadId };
    const updateUsage = async (params: CodexRecord) => {
      const info = object(params.tokenUsage);
      const last = object(info.last);
      const windowTokens = Number(info.modelContextWindow) || settings.maxContextTokens || 256000;
      let stats: RuntimeRequestContextStats = requestStats || { estimatedTotalTokens: 0, method: 'codex-input', breakdownAvailable: false };
      if (settings.provider === 'codex' && typeof last.inputTokens === 'number') {
        const signature = JSON.stringify({ last, total: info.total });
        if (signature !== nativeUsageSignature && last.inputTokens > 0) {
          nativeUsageSignature = signature;
          aiRequest.id = `model-request:${randomUUID()}`; aiRequest.createdAt = new Date().toISOString();
          stats = { estimatedTotalTokens: Math.max(0, last.inputTokens), actualInputTokens: Math.max(0, last.inputTokens),
            method: 'codex-input', breakdownAvailable: false };
        }
      }
      // Native totals include output. Bridge requests have their own measured
      // input and categories; a later usage notification must not erase them.
      await publishContextStats({ ...stats, windowTokens });
    };
    // Publish ownership even before the first provider usage event arrives.
    await updateUsage({ tokenUsage: { last: {}, modelContextWindow: settings.maxContextTokens } });
    if (recovered.length) {
      binding.pendingRecovery = [...(binding.pendingRecovery || []), ...recovered.map(messageToResponseItem).flat()];
      delete binding.pendingDeliveries; await persistBinding();
      await archive(recovered); await journal.clear();
    }
    if (binding.pendingRecovery?.length) {
      await client.request('thread/inject_items', { threadId: binding.threadId, items: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: `Host interruption recovery evidence. These calls must not be replayed; inspect current state.\n${JSON.stringify(binding.pendingRecovery)}` }] }] });
      delete binding.pendingRecovery; await persistBinding();
    }
    const operational = await input.getRuntimeOperationalContext?.(Object.keys(definitions));
    credentials = operational?.credentialBindings || credentials;
    const knowledge = (operational?.knowledge || []).filter(block => block.bodyAvailable !== false).map(runtimeKnowledgeMessage);
    await archive(knowledge);
    const context = [operational?.operationalContext || input.operationalContext, currentRuntimeTimePromptLine(),
      ...knowledge.map(message => typeof message.content === 'string' ? message.content
        : message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n'))].filter(Boolean).join('\n\n');
    const userInput: CodexInput[] = [{ type: 'text', text: input.modelInstruction || input.instruction },
      ...(settings.supportsImageInput ? (input.referenceImagePaths || []).map(path => ({ type: 'localImage' as const, path })) : [])];
    // Persist a host turn identity before dispatch; never transparently replay a failed turn/start.
    binding.lastClientTurnId = input.turnId || input.runId;
    binding.lastTurnStatus = 'dispatching'; await persistBinding();
    await archive([userMessage]);
    const handlers = {
      signal,
      onEvent: async (method: string, params: CodexRecord) => {
        if (method === 'turn/started') {
          activeTurnId = String(object(params.turn).id); binding!.lastTurnStatus = 'inProgress'; await persistBinding();
          await debug('ai:runtime:attempt', '本轮处理已开始', { aiRequest });
        }
        if (method === 'item/started') {
          const item = object(params.item); itemState(item);
          if (item.type === 'dynamicToolCall') await publishOutput(item);
          if (item.type === 'contextCompaction') await debug('ai:context-compression:start', '正在压缩上下文', { itemId: item.id });
        }
        if (method === 'item/agentMessage/delta') {
          const id = String(params.itemId); const text = (textById.get(id) || '') + String(params.delta || ''); textById.set(id, text); lastText = text;
          const state = itemState({ id, type: 'agentMessage' });
          await input.onTextStream?.({ agentStepIndex: state.index, runtimeStepIndex: stepIndex, stepNumber: state.index - 1,
            delta: '', text: modelVisibleText(text, true) });
        } else if (method === 'item/reasoning/summaryTextDelta' || method === 'item/reasoning/textDelta') {
          const id = `reasoning:${params.itemId}:${params.summaryIndex || 0}`; const text = (textById.get(id) || '') + String(params.delta || ''); textById.set(id, text);
          await input.onReasoningStream?.({ agentStepIndex: itemState({ id: params.itemId, type: 'reasoning' }).index, runtimeStepIndex: stepIndex,
            index: Number(params.summaryIndex) || 0, text: modelVisibleText(text, true), active: true });
        } else if (method === 'thread/tokenUsage/updated') await updateUsage(params);
        else if (method === 'item/completed') {
          const item = object(params.item);
          if (item.type === 'agentMessage' && item.text && !seenMessages.has(String(item.id))) {
            seenMessages.add(String(item.id)); transcript.push({ role: 'assistant', content: String(item.text) }); lastText = String(item.text);
            if (item.phase !== 'commentary') finalText = containsModelToolProtocol(lastText) ? '' : modelVisibleText(lastText);
            await publishTranscript();
          }
          if (item.type === 'reasoning') for (const [id, text] of textById) if (id.startsWith(`reasoning:${item.id}:`)) {
            await input.onReasoningStream?.({ agentStepIndex: itemState(item).index, runtimeStepIndex: stepIndex,
              index: Number(id.split(':').at(-1)) || 0, text: modelVisibleText(text), active: false });
          }
          if (item.type === 'contextCompaction') { loadedSkills.clear(); await debug('ai:context-compression:complete', '上下文压缩已完成', { itemId: item.id, agentStepIndex: itemState(item).index, committed: true }); }
          await publishOutput(item, true);
          if (item.type === 'dynamicToolCall') {
            if (binding!.pendingDeliveries?.[String(item.id)]) {
              delete binding!.pendingDeliveries[String(item.id)]; await persistBinding();
            }
            if ((accepted || pauseRequested) && activeTurnId) await client.request('turn/interrupt', { threadId: binding!.threadId, turnId: activeTurnId });
          }
        } else if (method === 'error') await debug(params.willRetry ? 'ai:runtime:recoverable-error' : 'ai:runtime:error',
          String(object(params.error).message || 'Codex request failed'), { ...params, error: codexRuntimeError(params.error), terminal: !params.willRetry });
      },
      onTool: async (call: CodexToolCall) => {
        assertActive();
        finalText = '';
        const startedAt = Date.now();
        const liveContext = await input.getRuntimeOperationalContext?.();
        if (liveContext?.credentialBindings) credentials = liveContext.credentialBindings;
        const name = call.tool;
        const definition = call.namespace === 'orbit' ? definitions[name] : undefined;
        const validation = definition ? await asSchema(definition.inputSchema).validate?.(call.arguments) : undefined;
        const args = validation?.success ? validation.value : call.arguments;
        const rejection = !definition?.execute || disabled.has(name) || !isRuntimeToolEnabled(name, runtimeConfiguration()) || accepted || pauseRequested
          ? 'This tool is unavailable in the current host scope. No action was executed.'
          : validation && !validation.success ? `Invalid tool arguments: ${validation.error}` : undefined;
        const item = { id: call.callId, type: 'dynamicToolCall', tool: name, arguments: args };
        await publishOutput(item);
        let trace = traces.find(trace => trace.id === call.callId);
        if (!trace) { trace = { id: call.callId, name, input: args, startedAt,
          contextBefore: contextSnapshot(), aiRequestElapsedMs: modelRequestElapsedMs }; traces.push(trace); }
        if (validation && !validation.success) trace.invalid = true;
        await publishTrace(trace);
        const decision: ModelMessage = { role: 'assistant', content: [{ type: 'tool-call', toolCallId: call.callId, toolName: name, input: args }] };
        await archive([decision]);
        await journal.plan([decision], [{ toolCallId: call.callId, toolName: name, input: args }]);
        let value: unknown;
        let failed = false;
        try {
          if (rejection) value = { ok: false, outcome: 'not-executed', actual: rejection,
            ...(validation && !validation.success ? { error: codexRuntimeError(validation.error) } : {}) };
          else if (!await host.approve(name, args)) value = { ok: false, outcome: 'not-executed', actual: 'Host denied this action.' };
          else if (!isRuntimeToolEnabled(name, runtimeConfiguration())) value = { ok: false, outcome: 'not-executed', actual: 'This tool is unavailable under the deployment permissions or tool settings. No action was executed.' };
          else {
            assertActive(); await journal.begin(call.callId);
            value = await definition!.execute!(args, { toolCallId: call.callId, messages: [], abortSignal: signal, context: undefined });
          }
        } catch (error) {
          if (input.abortSignal?.aborted) throw error;
          failed = true; value = { ok: false, outcome: journal.state.pending?.phase === 'executing' ? 'unknown' : 'not-executed',
            actual: error instanceof Error ? error.message : String(error), error: codexRuntimeError(error), safeToRetry: false };
        }
        const receipt: ModelMessage = { role: 'tool', content: [{ type: 'tool-result', toolCallId: call.callId, toolName: name,
          output: { type: failed ? 'error-json' : 'json', value: safeJson(value) } }] };
        await archive([receipt]); await journal.result(receipt, failed);
        // Keep the receipt durable until Codex acknowledges it. Several dynamic requests may already be queued.
        (binding!.pendingDeliveries ??= {})[call.callId] = [decision, receipt]; await persistBinding();
        transcript.push(decision, receipt); await publishTranscript(); await journal.clear();
        for (const id of hiddenRuntimeSkillIdsInModelContext([receipt])) loadedSkills.add(id);
        if (name === 'skill') { const id = object(args).skillId; if (typeof id === 'string' && object(value).ok === true) loadedSkills.add(id); }
        if (!trace.result) {
          trace.result = { ok: !failed && object(value).ok !== false, actual: String(object(value).actual || JSON.stringify(safeJson(value))), data: safeJson(value) };
          trace.completedAt = Date.now(); trace.elapsedMs = Date.now() - startedAt;
          if (failed) {
            const error = object(object(value).error);
            trace.executionError = { ...error, name: String(error.name || 'Error'), message: String(error.message || trace.result.actual),
              stack: typeof error.stack === 'string' ? error.stack : undefined };
          }
          await publishTrace(trace);
        }
        pauseRequested = browserChatHasPendingHumanInput(host.summarizeTraces(traces)) || Boolean(host.humanPause(traces));
        const contentItems: CodexToolOutput[] = [{ type: 'inputText', text: JSON.stringify(safeJson(value)) }];
        const returned = traces.findLast(trace => trace.id === call.callId)?.result;
        const screenshot = returned?.browserObservation;
        if (settings.supportsImageInput && screenshot?.status === 'available' && screenshot.path) images.push({ path: screenshot.path, source: 'browser' });
        const imagePaths = new Set<string>();
        const pendingImages = images.splice(0).filter(image => {
          if (imagePaths.has(image.path)) return false;
          imagePaths.add(image.path); return true;
        });
        if (settings.supportsImageInput) for (const image of pendingImages) {
          contentItems.push({ type: 'inputText', text: `Visual evidence (${image.source}): ${image.label || image.path}` });
          const binary = await readScreenshotForAi(image.path);
          if (binary) contentItems.push({ type: 'inputImage', imageUrl: `data:${binary.mediaType};base64,${binary.data.toString('base64')}` });
        }
        await publishStep();
        await publishOutput(item);
        return { success: !failed && object(value).ok !== false, contentItems };
      },
    };
    let nextInput = userInput;
    let clientTurnId = binding.lastClientTurnId;
    let invalidProtocolAttempts = 0;
    for (;;) {
      assertActive(); signal.throwIfAborted(); finalText = '';
      await debug('ai:runtime:request', '正在处理请求', { aiRequest, aiInput: {
        model: settings.model, threadId: binding.threadId, input: nextInput, additionalContext: context,
        baseInstructions: developerInstructions, tools: schemaTools, historyManagedBy: 'codex-app-server',
      } });
      const completed = await client.runTurn({ threadId: binding.threadId, model: settings.model, effort: aiReasoningEffort(),
        clientUserMessageId: clientTurnId, input: nextInput,
        additionalContext: context ? { 'orbit-runtime': { kind: 'application', value: context } } : undefined }, handlers);
      binding.lastTurnStatus = String(completed.status); await persistBinding();
      if (!accepted && !pauseRequested && completed.status !== 'completed') throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, String(object(completed.error).message || `Codex turn ${completed.status}`), { cause: completed.error });
      if (accepted || pauseRequested) break;
      // Native final text follows the same host validation path as an explicit finalResponse call.
      let feedback = 'No final answer was provided.';
      if (containsModelToolProtocol(lastText)) {
        if (++invalidProtocolAttempts >= 3) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, '模型连续返回了文本形式的工具协议，未形成有效工具调用。请检查供应商的原生工具调用配置。');
        feedback = 'Textual XML/tool_call markup is not executable. Use only native tool calls with the supplied schemas. Do not print or imitate tool protocol in assistant text.';
      }
      if (finalText) {
        const proposal: StructuredResponse = { status: 'passed', blocks: [markdownBlock(finalText)], completion: { complete: true, remainingWork: [] } };
        const callId = `host_final_${activeTurnId}`;
        const receipt = await handlers.onTool({ threadId: binding.threadId, turnId: activeTurnId, callId, namespace: 'orbit', tool: 'finalResponse', arguments: proposal });
        await publishOutput({ id: callId, type: 'dynamicToolCall', tool: 'finalResponse', arguments: proposal }, true);
        delete binding.pendingDeliveries?.[callId]; await persistBinding();
        if (accepted || pauseRequested) break;
        feedback = receipt.contentItems.filter(item => item.type === 'inputText').map(item => item.text).join('\n');
      }
      await debug('ai:runtime:recoverable-error', '终答未通过完成校验，继续处理', { feedback, terminal: false });
      nextInput = [{ type: 'text', text: `Host completion validation feedback (the active user request is unchanged):\n${feedback}\nContinue the feasible work. End through orbit.finalResponse after completion, or use the appropriate host human-input tool if essential user-owned information is required.` }];
      clientTurnId = `${input.turnId || input.runId}:completion:${randomUUID()}`;
      binding.lastClientTurnId = clientTurnId; binding.lastTurnStatus = 'dispatching'; await persistBinding();
    }
    const completedTools = host.summarizeTraces(traces).map(call => ({ name: call.name, result: call.rawResult }));
    let blocks: BrowserChatFinalBlock[] = accepted?.blocks || [];
    let reply = accepted ? browserChatFinalBlocksToText(blocks) : host.humanPause(traces)
      || browserChatRequestedUserInput(host.summarizeTraces(traces)) || lastText || '等待用户补充信息或完成验证。';
    if (!blocks.length && reply) blocks = [markdownBlock(reply)];
    const status = pauseRequested ? 'blocked' : accepted?.status === 'failed' ? 'failed' : 'passed';
    await debug('ai:runtime:attempt-succeeded', pauseRequested ? '正在等待用户输入' : '本轮处理已结束', { finishReason: 'stop', responseStatus: status, terminal: true });
    const responseSession = new ResponseSession(responseRegistry);
    for (const trace of traces) if (trace.result?.ok) responseSession.observe(trace.name, browserChatCapabilityResult(trace.result));
    if (accepted) responseSession.accept(accepted);
    blocks = responseSession.finish({ status, blocks }).blocks.map(block => responseRegistry.mapText(block, text => repairFileArtifactDownloadLinks(text, completedTools)));
    reply = browserChatFinalBlocksToText(blocks);
    assertActive();
    return { status, reply, blocks, steps, newSteps, consoleErrors: [], networkErrors: input.session.getNetworkErrors(),
      modelMessages: transcript, turnMessages: transcript };
  } catch (error) {
    if (input.abortSignal?.aborted || (input.shouldContinue && !input.shouldContinue())) throw error;
    if (binding) { binding.lastTurnStatus = 'failed'; await persistBinding(); }
    const message = executionStatusText(error instanceof Error ? error.message : String(error));
    const upstreamMessage = typeof modelFailure?.message === 'string' ? modelFailure.message : '';
    const reply = `会话执行失败：${message}${upstreamMessage && !message.includes(upstreamMessage) ? `；模型供应商：${upstreamMessage}` : ''}`;
    await debug('ai:runtime:error', reply, { error: codexRuntimeError(error), upstreamError: modelFailure, aiRequest, terminal: true });
    transcript.push({ role: 'assistant', content: reply }); await publishTranscript();
    await publishStep(reply);
    return { status: 'failed', reply, blocks: [markdownBlock(reply)], steps, newSteps,
      consoleErrors: [], networkErrors: input.session.getNetworkErrors(), modelMessages: transcript, turnMessages: transcript };
  } finally { try { await runtime?.close(); } finally { await mount.dispose(); } }
}

function safeJson(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null, (_key, item) => typeof item === 'bigint' ? String(item) : item));
}

function messageToResponseItem(message: ModelMessage): unknown[] {
  if (typeof message.content === 'string') return [{ type: 'message', role: message.role === 'system' ? 'developer' : message.role,
    content: [{ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: message.content }] }];
  return message.content.flatMap((part): unknown[] => {
    if (part.type === 'text') return [{ type: 'message', role: message.role, content: [{ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: part.text }] }];
    if (part.type === 'tool-call') return [{ type: 'function_call', namespace: 'orbit', name: part.toolName, call_id: part.toolCallId, arguments: JSON.stringify(part.input) }];
    if (part.type === 'tool-result') return [{ type: 'function_call_output', call_id: part.toolCallId,
      output: 'value' in part.output ? typeof part.output.value === 'string' ? part.output.value : JSON.stringify(part.output.value) : JSON.stringify(part.output) }];
    return [];
  });
}

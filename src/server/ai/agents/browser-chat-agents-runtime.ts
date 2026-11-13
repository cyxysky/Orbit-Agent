import { runtimeConfiguration, runtimeSetting } from '@/server/settings/runtime-configuration';
import { randomUUID } from 'node:crypto';
import { Agent, Runner, RunState, type Model, type AgentInputItem } from '@openai/agents-core';
import { aisdk } from '@openai/agents-extensions/ai-sdk';
import { adaptAISDKToolsForAgents } from '@cjfclonedeep/capability-sdk/adapters/openai-agents';
import { OrbitAgentSession } from './agents-session';
import { agentItemsToModelMessages, modelMessagesToAgentItems, recoverAgentToolHistory, parseAgentToolArguments, projectAgentToolMedia } from './agents-message-conversion';
import { prepareRuntimeContext } from './runtime-context-runtime';
import { parsePartialJson, generateText, asSchema, type ModelMessage, type ToolSet } from 'ai';
import { markdownBlock } from '@cjfclonedeep/capability-sdk/responses';
import { ResponseSession, type StructuredResponse } from '@cjfclonedeep/capability-sdk';
import { getModel, getModelSettings } from '@/server/ai/model';
import { aiReasoningEffort, aiRuntimeRequestTimeoutMs, aiRuntimeStreamTimeouts, createAiRequestWatchdog } from '@/server/ai/ai-sdk-runtime';
import { runtimeError, runtimeToolFailure } from '@/server/ai/runtime-errors';
import { recordAgentsModelMetrics } from '@/server/ai/ai-sdk-telemetry';
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
import { calibrateRuntimeRequestContext, estimateRuntimeRequestContext, runtimeContextProfile, runtimeProviderInputTokens, type RuntimeRequestContextStats } from './runtime-context-budget';
import { readScreenshotForAi } from './browser-chat-image-input';
import { RuntimeExecutionJournal } from './runtime-execution-journal';
import { browserInteractionInstructions } from './runtime-browser-interaction';
import { normalizeBrowserChatInteractionMode } from '@/lib/browser-chat-interaction-mode';
import { summarizeRuntimeLogTimings } from './runtime-log-timings';
import type { InteractiveBrowserTurnResult, executeInteractiveBrowserTurn } from './browser-chat-executor.agent';
import type { BrowserActionResult } from '@cjfclonedeep/capability-sdk/browser/node';
import type { StepExecutionResult, StepToolCall, AiRequestSnapshot, AiToolContextSnapshot } from '@/server/ai/schemas/runtime.schema';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';
import { modelVisibleText, containsModelToolProtocol } from '@/lib/model-visible-text';
import { executionStatusText } from '@/lib/execution-log-presentation';


type Input = Parameters<typeof executeInteractiveBrowserTurn>[0];
type Trace = { id?: string; name: string; input: unknown; result?: BrowserActionResult; startedAt?: number; completedAt?: number;
  invalid?: boolean; elapsedMs?: number; actionElapsedMs?: number; progress?: StepToolCall['progress'];
  contextBefore?: AiToolContextSnapshot; contextAfter?: AiToolContextSnapshot; aiRequestElapsedMs?: number;
  executionError?: { name: string; message: string; stack?: string } };
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export type AgentsBrowserHost = {
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
};

/** Agents SDK owns the loop; Orbit owns durable history, tools and presentation. */
export async function executeAgentsBrowserTurn(input: Input, host: AgentsBrowserHost): Promise<InteractiveBrowserTurnResult> {
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
  const agentSession = await OrbitAgentSession.open(sessionId, scope, input.userId || 'local');
  let requestStats: RuntimeRequestContextStats | undefined;
  let modelRequestElapsedMs: number | undefined;
  const journal = new RuntimeExecutionJournal(input.runId, input.contextScope);
  const restoringApproval = agentSession.paused?.turnId === (input.turnId || input.runId);
  await journal.load();
  const recovered = restoringApproval ? [] : await journal.recover();
  let visualContext = journal.state.observations as StepExecutionResult['visualContext'];
  const userMessage: ModelMessage = { role: 'user', content: input.modelInstruction || input.instruction };
  transcript.push(userMessage);
  const aiRequest: AiRequestSnapshot = { id: randomUUID(), kind: 'runtime', stepIndex, createdAt: new Date().toISOString(),
    provider: settings.provider, model: settings.model, imageAttached: Boolean(input.referenceImagePaths?.length),
    messages: [{ role: 'user', content: [{ type: 'text', text: input.modelInstruction || input.instruction }] }],
    options: { engine: 'openai-agents' } };
  let modelRequestMessageCount = 0;
  let contextManifest: RuntimeContextManifest | undefined;
  const activeTurnId = input.turnId || input.runId;
  const items = new Map<string, { index: number; value: ObjectValue; startedAt: number; completed: boolean }>();
  const textById = new Map<string, string>();
  const loggedTraceStarts = new Set<string>();
  const loggedTraceProgress = new Map<string, string>();
  const itemState = (item: ObjectValue) => {
    const id = String(item.id);
    let state = items.get(id);
    if (!state) { state = { index: items.size + 1, value: item, startedAt: Date.now(), completed: false }; items.set(id, state); }
    else state.value = { ...state.value, ...item };
    return state;
  };
  const debug = async (phase: string, message: string, details: ObjectValue, toolCallId?: string) => {
    await input.onDebug?.({ phase, message, stepIndex, details: { __browserChatFullLogDetails: true, value: {
      engine: 'openai-agents', runId: activeTurnId, ...details },
      execution: { turnId: input.turnId || input.runId, attemptId: aiRequest.id, toolCallId } } });
  };
  const publishOutput = async (item: ObjectValue, completed = false) => {
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
      totalElapsedMs: elapsedMs, aiElapsedMs: 0,
      traces: trace ? [trace] : [],
    }) : undefined;
    state.completed ||= completed;
    await debug('ai:runtime:response', item.type === 'dynamicToolCall' ? `${item.tool} 工具${completed ? '已结束' : '已请求'}`
      : modelVisibleText(String(item.text || '模型思考记录')).slice(0, 220), { aiRequest, aiOutput: {
      engine: 'openai-agents', itemId: id, agentStepIndex: state.index, response: { content, phase: item.phase },
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
    // UI/archive projection; the database Agent session owns model history.
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
    aiRequest.options = { ...aiRequest.options, modelContextStats: { ...stats, engine: 'openai-agents' } };
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
    {
      const manifest: RuntimeContextManifest = { version: 2, id: `ctxreq_${randomUUID()}`, createdAt: aiRequest.createdAt, sessionId,
        engine: 'openai-agents',
        contextWindowTokens: stats.windowTokens || settings.maxContextTokens || 256000,
        estimatedTokensBefore: stats.estimatedTotalTokens, estimatedTokensAfter: stats.estimatedTotalTokens,
        messageCount: modelRequestMessageCount, summaryMessageCount: 0, knowledge: [],
        model: { provider: settings.provider, model: settings.model }, ...contextManifest, modelContextStats: stats,
        countKind: stats.actualInputTokens === undefined ? 'heuristic' : 'provider' };
      await input.onContextCheckpoint?.({ records: {}, manifest });

    }
    await debug('ai:runtime:context', '模型请求上下文用量已更新', { modelRequestId: aiRequest.id,
      modelContextStats: aiRequest.options.modelContextStats });
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
      if (traces.some(trace => trace.name !== 'finalResponse' && !trace.completedAt)
        || journal.state.pending?.calls.some(call => call.toolName !== 'finalResponse' && !journal.state.pending?.results.some(result => result.role === 'tool' && result.content.some(part => part.type === 'tool-result' && part.toolCallId === call.toolCallId)))) return 'Tool calls are still running. Wait for their results before completing the request.';
      accepted = response;
      return undefined;
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

  const signal = input.abortSignal ?? new AbortController().signal;
  let projectedInput: AgentInputItem[] = [];
  let sourceInputCount = 0;
  let previousSourceInput: AgentInputItem[] = [];
  let continuationSummary = agentSession.continuationSummary;
  let modelRequest = 0;
  let modelStartedAt = 0;
  let firstOutputAt = 0;
  let outputCharacters = 0;
  let performancePublishedAt = 0;
  let finishReason = 'stop';
  let finalText = '';
  const providerTools = new Map<string, { name: string; arguments: string }>();
  const recordedToolResults = new Set<string>();
  const publishProviderPart = async (raw: unknown) => {
    const part = object(raw), kind = String(part.type || ''), id = String(part.id || part.toolCallId || '');
    if (kind === 'finish') finishReason = typeof part.finishReason === 'string' ? part.finishReason : String(object(part.finishReason).unified || 'stop');
    if (['text-delta', 'reasoning-delta', 'tool-input-start', 'tool-input-delta', 'tool-call'].includes(kind)) {
      if (!firstOutputAt) {
        firstOutputAt = Date.now();
        await debug('ai:runtime:receiving', '正在接收模型输出', { modelRequestId: aiRequest.id, firstOutputMs: firstOutputAt - modelStartedAt });
      }
      if (kind.endsWith('delta')) outputCharacters += String(part.delta || '').length;
      if (Date.now() - performancePublishedAt >= 160 || kind === 'tool-input-start') {
        performancePublishedAt = Date.now();
        const outputDurationMs = Date.now() - firstOutputAt;
        const outputTokens = Math.ceil(outputCharacters / 2);
        await input.onTextStream?.({ agentStepIndex: 0, runtimeStepIndex: stepIndex, stepNumber: modelRequest, delta: '', text: '',
          performance: { outputTokens, outputDurationMs, estimated: true, timeToFirstOutputMs: firstOutputAt - modelStartedAt,
            outputTokensPerSecond: outputDurationMs > 0 ? outputTokens * 1000 / outputDurationMs : undefined } });
      }
    }
    if (kind === 'text-delta') {
      const key = aiRequest.id + ':text:' + String(part.id || 'text');
      const text = (textById.get(key) || '') + String(part.delta || '');
      textById.set(key, text);
      await input.onTextStream?.({ itemId: key, agentStepIndex: itemState({ id: key, type: 'agentMessage' }).index,
        runtimeStepIndex: stepIndex, stepNumber: modelRequest, delta: '', text: modelVisibleText(text, true) });
    } else if (kind === 'reasoning-delta') {
      const key = aiRequest.id + ':reasoning:' + id, text = (textById.get(key) || '') + String(part.delta || '');
      textById.set(key, text);
      await input.onReasoningStream?.({ itemId: key, agentStepIndex: itemState({ id: key, type: 'reasoning' }).index,
        runtimeStepIndex: stepIndex, index: 0, text: modelVisibleText(text, true), active: true });
    } else if (kind === 'tool-input-start') {
      const name = String(part.toolName || '');
      providerTools.set(id, { name, arguments: '' });
      if (name) await publishOutput({ id, type: 'dynamicToolCall', tool: name, arguments: {} });
    } else if (kind === 'tool-input-delta') {
      const pending = providerTools.get(id);
      if (!pending) return;
      pending.arguments += String(part.delta || '');
      if (pending.name !== 'finalResponse') return;
      const parsed = await parsePartialJson(pending.arguments);
      const blocks = list(object(parsed.value).blocks).flatMap(value => {
        const block = object(value), params = object(block.params);
        return block.type === 'core.markdown' && typeof params.text === 'string'
          ? [{ type: 'core.markdown', params: { text: modelVisibleText(params.text, true) } }] : [];
      });
      await input.onTextStream?.({ agentStepIndex: 0, runtimeStepIndex: stepIndex, stepNumber: modelRequest,
        delta: '', text: '', responseDraft: { id, blocks } });
    }
  };
  const checkpointHistory = (items: AgentInputItem[]) => agentSession.checkpoint(items, continuationSummary);
  const executeTool = async (call: { name: string; input: unknown; callId: string; validate?(): Promise<void>; invoke(): Promise<unknown> }) => {
    assertActive();
    const { name, input: args, callId } = call, startedAt = Date.now();
    const liveContext = await input.getRuntimeOperationalContext?.();
    if (liveContext?.credentialBindings) credentials = liveContext.credentialBindings;
    const item = { id: callId, type: 'dynamicToolCall', tool: name, arguments: args };
    await publishOutput(item);
    let trace = traces.find(trace => trace.id === callId);
    if (!trace) { trace = { id: callId, name, input: args, startedAt, contextBefore: contextSnapshot(), aiRequestElapsedMs: modelRequestElapsedMs }; traces.push(trace); }
    await publishTrace(trace);
    const decision: ModelMessage = { role: 'assistant', content: [{ type: 'tool-call', toolCallId: callId, toolName: name, input: args }] };
    if (!journal.state.pending) {
      await agentSession.addItems(modelMessagesToAgentItems([decision]));
      transcript.push(decision);
      await archive([decision]);
      await journal.plan([decision], [{ toolCallId: callId, toolName: name, input: args }]);
    }
    let value: unknown, failed = false, invocationStarted = false;
    try {
      await agentSession.finish();
      if (!definitions[name] || disabled.has(name) || !isRuntimeToolEnabled(name, runtimeConfiguration()) || accepted || pauseRequested) {
        value = { ok: false, outcome: 'not-executed', actual: 'This tool is unavailable in the current host scope. No action was executed.' };
      } else {
        await call.validate?.();
        assertActive();
        await journal.begin(callId);
        invocationStarted = true;
        value = await call.invoke();
      }
    } catch (error) {
      if (signal.aborted) throw error;
      failed = true;
      const failure = runtimeToolFailure(error, invocationStarted || Boolean(journal.state.pending?.startedCallIds?.includes(callId)));
      if ('retryRequiresInputChange' in failure && failure.retryRequiresInputChange) trace.invalid = true;
      value = failure;
    }
    const receipt: ModelMessage = { role: 'tool', content: [{ type: 'tool-result', toolCallId: callId, toolName: name,
      output: { type: failed ? 'error-json' : 'json', value: safeJson(value) } }] };
    await archive([receipt]); await journal.result(receipt, failed);
    transcript.push(receipt); await publishTranscript();
    for (const id of hiddenRuntimeSkillIdsInModelContext([receipt])) loadedSkills.add(id);
    if (name === 'skill' && object(value).ok === true && typeof object(args).skillId === 'string') loadedSkills.add(String(object(args).skillId));
    if (!trace.result) {
      trace.result = { ok: !failed && object(value).ok !== false && object(value).accepted !== false,
        actual: String(object(value).actual || JSON.stringify(safeJson(value))), data: safeJson(value) };
      trace.completedAt = Date.now(); trace.elapsedMs = Date.now() - startedAt;
      await publishTrace(trace);
    }
    pauseRequested = browserChatHasPendingHumanInput(host.summarizeTraces(traces)) || Boolean(host.humanPause(traces));
    const content: Array<{ type: 'text'; text: string } | { type: 'image'; image: string }> = [{ type: 'text', text: JSON.stringify(safeJson(value)) }];
    const screenshot = trace.result?.browserObservation;
    if (settings.supportsImageInput && screenshot?.status === 'available' && screenshot.path) images.push({ path: screenshot.path, source: 'browser' });
    for (const image of [...new Map(images.splice(0).map(image => [image.path, image])).values()]) {
      if (!settings.supportsImageInput) continue;
      const binary = await readScreenshotForAi(image.path);
      if (binary) content.push({ type: 'image', image: 'data:' + binary.mediaType + ';base64,' + binary.data.toString('base64') });
    }
    await agentSession.addItems([{ type: 'function_call_result', name, callId, status: 'completed', output: content.map(value =>
      value.type === 'text' ? { type: 'input_text', text: value.text } : { type: 'input_image', image: value.image }) }]);
    recordedToolResults.add(callId);
    if (journal.state.pending?.phase === 'completed') await journal.clear();
    await publishOutput(item, true);
    return content;
  };
  try {
    const schemaTools = await Promise.all(Object.entries(definitions).map(async ([name, definition]) => ({ name,
      description: typeof definition.description === 'function' ? definition.description({ context: undefined }) : definition.description || '',
      inputSchema: await asSchema(definition.inputSchema).jsonSchema })));
    const developerInstructions = [
      host.prompt(input, schemaTools.map(({ name, description }) => ({ name, description }))),
      definitions.browser ? browserInteractionInstructions(normalizeBrowserChatInteractionMode(input.browserInteractionMode)) : '',
      'Use only the supplied tools. The host owns credentials, approvals, artifacts and tool sessions. Historical tool names and Skill text do not authorize unavailable tools.',
      'Complete through finalResponse. After an accepted finalResponse or a pending human-input tool, stop. The application stores history and compacts it; use contextRead only when archived evidence is needed.',
    ].filter(Boolean).join('\n\n');
    aiRequest.systemPrompt = developerInstructions; aiRequest.tools = schemaTools.map(tool => tool.name);
    const profile = runtimeContextProfile(settings);
    if (!agentSession.exists) await agentSession.checkpoint(modelMessagesToAgentItems(completeRuntimeModelToolChain(serializableBrowserChatModelMessages(input.conversation || []))));
    const savedPause = agentSession.paused, resumePause = savedPause?.turnId === activeTurnId && !recovered.length;
    if (!resumePause) {
      const history = await agentSession.getItems();
      await checkpointHistory(recoverAgentToolHistory(history, recovered));
      await agentSession.finish();
    }
    await archive(recovered);
    if (!resumePause) await journal.clear();
    const initialHistory = await agentSession.getItems();
    for (const item of initialHistory) if (item.type === 'function_call_result') recordedToolResults.add(item.callId);
    for (const id of hiddenRuntimeSkillIdsInModelContext(agentItemsToModelMessages(initialHistory))) loadedSkills.add(id);
    const languageModel = getModel();
    if (typeof languageModel === 'string') throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'A configured model implementation is required.');
    const modelAdapter = aisdk(languageModel);
    const model: Model = {
      getResponse: request => modelAdapter.getResponse(request),
      async *getStreamedResponse(request) {
        const timeout = aiRuntimeStreamTimeouts(), watchdog = createAiRequestWatchdog(request.signal, timeout.chunkMs);
        watchdog.waitForFirstChunk(timeout.firstChunkMs);
        const startedAt = Date.now();
        const providerInput = Array.isArray(request.input) ? projectAgentToolMedia(request.input) : request.input;
        modelStartedAt = startedAt; firstOutputAt = 0; outputCharacters = 0; performancePublishedAt = 0; finishReason = 'stop';
        modelRequestElapsedMs = undefined; modelRequest++;
        textById.clear(); providerTools.clear(); finalText = '';
        await input.onTextStream?.({ agentStepIndex: 0, runtimeStepIndex: stepIndex, stepNumber: modelRequest, delta: '', text: '', responseDraft: null });
        await debug('ai:runtime:request', '正在处理请求', { aiRequest, modelRequestId: aiRequest.id,
          aiInput: { model: settings.model, messages: agentItemsToModelMessages(Array.isArray(providerInput) ? providerInput : []), tools: schemaTools, systemPrompt: request.systemInstructions } });
        const iterator = modelAdapter.getStreamedResponse({ ...request, modelSettings: { ...request.modelSettings, preserveRawUsage: true },
          input: providerInput, signal: watchdog.abortSignal })[Symbol.asyncIterator]();
        try {
          for (;;) {
            const next = await watchdog.run(iterator.next());
            if (next.done) break;
            const event = next.value;
            if (event.type === 'model') {
              const part = object(event.event);
              watchdog.firstChunkReceived({ type: String(part.type) });
              await publishProviderPart(part);
            }
            if (event.type === 'response_done') {
              modelRequestElapsedMs = Date.now() - startedAt;
              const output = event.response.output;
              await agentSession.addItems(output);
              const messages = agentItemsToModelMessages(output);
              transcript.push(...messages); await publishTranscript();
              const decisions = messages.filter(message => message.role === 'assistant' && Array.isArray(message.content) && message.content.some(part => part.type === 'tool-call'));
              const calls = output.flatMap(item => item.type === 'function_call' ? [{ toolCallId: item.callId, toolName: item.name, input: parseAgentToolArguments(item.arguments) }] : []);
              if (calls.length) await journal.plan(decisions, calls);
              for (const item of output) {
                if (item.type === 'message' && item.role === 'assistant') {
                  const text = item.content.flatMap(part => part.type === 'output_text' ? [part.text] : []).join('');
                  if (text) finalText = containsModelToolProtocol(text) ? '' : modelVisibleText(text);
                  await publishOutput({ id: aiRequest.id + ':text:' + (item.id || 'text'), type: 'agentMessage', text, phase: calls.length ? 'commentary' : 'final' }, true);
                } else if (item.type === 'reasoning') {
                  const itemId = aiRequest.id + ':reasoning:' + (item.id || '');
                  await publishOutput({ id: itemId, type: 'reasoning', summary: item.content?.map(part => part.text) || [] }, true);
                  await input.onReasoningStream?.({ itemId, agentStepIndex: itemState({ id: itemId, type: 'reasoning' }).index,
                    runtimeStepIndex: stepIndex, index: 0, text: item.content?.map(part => part.text).join('\n') || '', active: false });
                } else if (item.type === 'function_call') await publishOutput({ id: item.callId, type: 'dynamicToolCall', tool: item.name, arguments: parseAgentToolArguments(item.arguments) });
              }
              const actualInputTokens = runtimeProviderInputTokens(event.response);
              if (requestStats && actualInputTokens !== undefined) await publishContextStats(calibrateRuntimeRequestContext(requestStats, actualInputTokens));
              const outputDurationMs = firstOutputAt ? Date.now() - firstOutputAt : 0;
              recordAgentsModelMetrics({ provider: settings.provider, model: settings.model, finishReason,
                responseTimeMs: modelRequestElapsedMs, firstOutputMs: firstOutputAt ? firstOutputAt - startedAt : undefined,
                outputDurationMs, usage: event.response.usage });
              const measuredOutputTokens = event.response.usage.outputTokens > 0 ? event.response.usage.outputTokens : undefined;
              const outputTokens = measuredOutputTokens ?? Math.ceil(outputCharacters / 4);
              await input.onTextStream?.({ agentStepIndex: 0, runtimeStepIndex: stepIndex, stepNumber: modelRequest, delta: '', text: '',
                performance: { outputTokens, outputDurationMs, estimated: measuredOutputTokens === undefined,
                  timeToFirstOutputMs: firstOutputAt ? firstOutputAt - startedAt : undefined,
                  outputTokensPerSecond: outputDurationMs > 0 ? outputTokens * 1000 / outputDurationMs : undefined } });
              await debug('ai:runtime:response', '模型响应已接收', { modelRequestId: aiRequest.id, aiRequest,
                aiOutput: { usage: event.response.usage, rawUsage: event.response.rawUsage, timings: { aiRequestElapsedMs: modelRequestElapsedMs } } });
            }
            yield event;
          }
        } finally {
          watchdog.dispose();
          if (watchdog.abortSignal.aborted) void iterator.return?.().catch(() => undefined);
          else await iterator.return?.();
        }
      },
    };
    const tools = await adaptAISDKToolsForAgents(definitions, { signal, needsApproval: true, execute: executeTool });
    const agent = new Agent({ name: 'Orbit', instructions: developerInstructions, model, tools,
      modelSettings: { toolChoice: 'auto', parallelToolCalls: true, reasoning: { effort: aiReasoningEffort() as Exclude<ReturnType<typeof aiReasoningEffort>, 'provider-default'> }, preserveRawUsage: true },
      toolUseBehavior: async () => accepted || pauseRequested
        ? { isFinalOutput: true, isInterrupted: undefined, finalOutput: accepted ? browserChatFinalBlocksToText(accepted.blocks) : '等待用户输入' }
        : { isFinalOutput: false, isInterrupted: undefined },
    });
    const runner = new Runner({ tracingDisabled: true, toolExecution: { maxFunctionToolConcurrency: 1 },
      callModelInputFilter: async ({ modelData }) => {
        assertActive();
        aiRequest.id = randomUUID(); aiRequest.createdAt = new Date().toISOString();
        const source = modelData.input;
        // Invalid JSON and SDK-side rejections do not invoke our executor. Record their results too.
        for (const item of source) if (item.type === 'function_call_result' && !recordedToolResults.has(item.callId)) {
          recordedToolResults.add(item.callId);
          await agentSession.addItems([item]);
          const receipts = agentItemsToModelMessages([item]);
          await archive(receipts);
          transcript.push(...receipts);
          if (journal.state.pending?.calls.some(call => call.toolCallId === item.callId)) {
            for (const receipt of receipts) await journal.result(receipt);
            if (journal.state.pending?.phase === 'completed') await journal.clear();
          }
          const trace = { id: item.callId, name: item.name, input: undefined, startedAt: Date.now(), completedAt: Date.now(),
            result: { ok: false, actual: typeof item.output === 'string' ? item.output : JSON.stringify(item.output) } };
          traces.push(trace); await publishTrace(trace);
          await publishOutput({ id: item.callId, type: 'dynamicToolCall', tool: item.name }, true);
        }
        const prefixMatches = sourceInputCount <= source.length && (!previousSourceInput.length
          || previousSourceInput.every((item, index) => JSON.stringify(item) === JSON.stringify(source[index])));
        const candidate = prefixMatches && projectedInput.length ? [...projectedInput, ...source.slice(sourceInputCount)] : source;
        sourceInputCount = source.length; previousSourceInput = source;
        const current = await input.getRuntimeOperationalContext?.(Object.keys(definitions));
        credentials = current?.credentialBindings || credentials;
        const messages = agentItemsToModelMessages(candidate);
        const pinnedUser = messages.findLast(message => message.role === 'user');
        const prepared = await prepareRuntimeContext({
          messages, currentUserIndex: pinnedUser ? messages.indexOf(pinnedUser) : Math.max(0, messages.length - 1), pinnedUser,
          system: developerInstructions, tools: schemaTools, operationalContext: current?.operationalContext || input.operationalContext || '',
          currentTimeLine: currentRuntimeTimePromptLine(), knowledge: current?.knowledge || [],
          contextWindowTokens: profile.windowTokens, inputBudgetTokens: profile.inputBudgetTokens,
          compressionTriggerTokens: profile.compressionTriggerTokens, compressionTargetTokens: profile.compressionTargetTokens,
          continuationSummary, sourceRecords: records, abortSignal: signal,
          generateSummary: async prompt => {
            const result = await generateText({ model: getModel(), prompt, abortSignal: AbortSignal.any([signal, AbortSignal.timeout(aiRuntimeRequestTimeoutMs())]),
              maxRetries: 0, maxOutputTokens: Math.min(16000, profile.inputBudgetTokens) });
            return { text: result.text, finishReason: result.finishReason, usage: result.usage };
          },
          onCheckpoint: async checkpoint => { await archive(checkpoint.segmentRecords); },
          onProgress: async progress => { await debug('ai:context-compression:' + (progress.stage === 'start' ? 'start' : 'progress'),
            progress.stage === 'complete' ? '上下文压缩已完成' : '正在压缩上下文', { progress }); },
        });
        await archive([...prepared.segmentRecords, ...prepared.activeMessages]);
        continuationSummary = prepared.continuationSummary;
        projectedInput = modelMessagesToAgentItems(prepared.activeMessages, candidate);
        await checkpointHistory(projectedInput);
        modelRequestMessageCount = prepared.messages.length;
        contextManifest = { ...prepared.manifest, engine: 'openai-agents' };
        await publishContextStats(estimateRuntimeRequestContext({ messages: [{ role: 'system', content: prepared.system }, ...prepared.messages], tools: schemaTools }, profile.windowTokens));
        if (prepared.compressedMessages) await input.onContextCompression?.({ activeMessages: prepared.activeMessages,
          contextCompression: { continuationSummary, compressedAt: new Date().toISOString(), summarizedMessageCount: prepared.compressedMessages,
            estimatedTokensBefore: prepared.manifest.estimatedTokensBefore, estimatedTokensAfter: prepared.manifest.estimatedTokensAfter,
            retainedMessageCount: prepared.activeMessages.length, targetTokens: profile.compressionTargetTokens,
            thresholdTokens: profile.compressionTriggerTokens, windowTokens: profile.windowTokens } });
        if (prepared.manifest.compression) await debug('ai:context-compression:complete', '上下文压缩处理已结束', {
          committed: true, compressedMessages: prepared.compressedMessages, compression: prepared.manifest.compression,
          compactionFailure: prepared.manifest.compactionFailure, beforeTokens: prepared.manifest.estimatedTokensBefore,
          afterTokens: prepared.manifest.estimatedTokensAfter,
        });
        return { instructions: prepared.system, input: modelMessagesToAgentItems(prepared.messages, candidate) };
      },
    });
    let next: AgentInputItem[] | RunState<unknown, typeof agent>;
    if (resumePause && savedPause) {
      projectedInput = savedPause.preparedInput; sourceInputCount = savedPause.sourceInputCount;
      next = await RunState.fromString(agent, savedPause.state);
    } else {
      const content: Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image: string }> = [{ type: 'input_text', text: input.modelInstruction || input.instruction }];
      if (settings.supportsImageInput) for (const path of input.referenceImagePaths || []) {
        const image = await readScreenshotForAi(path);
        if (image) content.push({ type: 'input_image', image: 'data:' + image.mediaType + ';base64,' + image.data.toString('base64') });
      }
      next = [...await agentSession.getItems(), { type: 'message', role: 'user', content }];
    }
    for (let completionAttempt = 0; ;) {
      assertActive();
      const configuredTurns = Number(runtimeSetting('AI_RUNTIME_MAX_TURNS'));
      const maxTurns = Number.isSafeInteger(configuredTurns) && configuredTurns > 0 ? configuredTurns : 100;
      const stream = await runner.run(agent, next, { stream: true, signal, maxTurns });
      for await (const event of stream) {
        assertActive();
        if (event.type === 'run_item_stream_event' && event.name === 'tool_output') await publishStep();
      }
      await stream.completed;
      const interruptions = stream.interruptions || [];
      if (interruptions.length) {
        await agentSession.pause({ turnId: activeTurnId, state: stream.state.toString(), preparedInput: projectedInput, sourceInputCount });
        if (journal.state.pending) await journal.save('awaiting-approval', state => { if (state.pending) state.pending.phase = 'awaiting-approval'; });
        for (const interruption of interruptions) {
          const call = interruption.rawItem;
          const allowed = call.type === 'function_call' && definitions[call.name] && !disabled.has(call.name)
            && isRuntimeToolEnabled(call.name, runtimeConfiguration()) && await host.approve(call.name, parseAgentToolArguments(call.arguments));
          if (allowed) stream.state.approve(interruption);
          else {
            stream.state.reject(interruption);
            if (call.type === 'function_call') await executeTool({ name: call.name, input: parseAgentToolArguments(call.arguments), callId: call.callId,
              invoke: async () => ({ ok: false, outcome: 'not-executed', actual: 'Host denied this action.' }) });
          }
        }
        next = stream.state; continue;
      }
      if (accepted || pauseRequested) break;
      if (finalText) {
        const proposal: StructuredResponse = { status: 'passed', blocks: [markdownBlock(finalText)] };
        const callId = 'host_final_' + aiRequest.id;
        await executeTool({ name: 'finalResponse', input: proposal, callId,
          invoke: () => definitions.finalResponse.execute!(proposal, { toolCallId: callId, messages: [], abortSignal: signal, context: undefined }) as Promise<unknown> });
        if (accepted || pauseRequested) break;
      }
      if (++completionAttempt >= 3) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, '模型未提交有效回复，或连续返回了文本形式的工具协议。');
      await agentSession.addItems([{ type: 'message', role: 'user', content: 'Host validation feedback: the active request is unchanged. Use native tool calls, not textual tool_call markup. Complete through finalResponse, or request essential user input through the supplied tool.' }]);
      next = await agentSession.getItems(); previousSourceInput = []; sourceInputCount = 0; projectedInput = [];
    }
    await agentSession.finish();
    const completedTools = host.summarizeTraces(traces).map(call => ({ name: call.name, result: call.rawResult }));
    const status = pauseRequested ? 'blocked' : accepted?.status ?? 'passed';
    let blocks: BrowserChatFinalBlock[] = accepted?.blocks || [];
    let reply = accepted ? browserChatFinalBlocksToText(blocks) : host.humanPause(traces)
      || browserChatRequestedUserInput(host.summarizeTraces(traces)) || '等待用户补充信息或完成验证。';
    if (!blocks.length) blocks = [markdownBlock(reply)];
    const responseSession = new ResponseSession(responseRegistry);
    for (const trace of traces) if (trace.result?.ok) responseSession.observe(trace.name, browserChatCapabilityResult(trace.result));
    if (accepted) responseSession.accept(accepted);
    blocks = responseSession.finish({ status, blocks }).blocks.map(block => responseRegistry.mapText(block, text => repairFileArtifactDownloadLinks(text, completedTools)));
    reply = browserChatFinalBlocksToText(blocks);
    await debug('ai:runtime:attempt-succeeded', pauseRequested ? '正在等待用户输入' : '本轮处理已结束', { finishReason: 'stop', responseStatus: status, terminal: true });
    assertActive();
    return { status, reply, blocks, steps, newSteps, consoleErrors: [], networkErrors: input.session.getNetworkErrors(), modelMessages: transcript, turnMessages: transcript };
  } catch (error) {
    if (signal.aborted || (input.shouldContinue && !input.shouldContinue())) throw error;
    const reply = '会话执行失败：' + executionStatusText(error instanceof Error ? error.message : String(error));
    await debug('ai:runtime:error', reply, { error: runtimeError(error), aiRequest, terminal: true });
    transcript.push({ role: 'assistant', content: reply }); await publishTranscript(); await publishStep(reply);
    return { status: 'failed', reply, blocks: [markdownBlock(reply)], steps, newSteps, consoleErrors: [], networkErrors: input.session.getNetworkErrors(), modelMessages: transcript, turnMessages: transcript };
  } finally { await mount.dispose(); }
}
function safeJson(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null, (_key, value) => typeof value === 'bigint' ? value.toString() : value));
}

import { createServer, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { jsonSchema, streamText, tool, type ModelMessage, type ToolSet, type UserContent } from 'ai';
import { asSchema } from '@ai-sdk/provider-utils';
import { getModel, getModelSettings, withModelSettings, type ModelSettingsOverride } from './model';
import { aiRuntimeRequestTimeoutMs, aiRuntimeStreamTimeouts, createAiRequestWatchdog } from './ai-sdk-runtime';
import { codexRuntimeError } from './codex-runtime-errors';
import { createBrowserChatOutputPerformance } from './agents/browser-chat-output-performance';
import { estimateRuntimeRequestContext, runtimeContextWindowTokens } from './agents/runtime-context-budget';
import type { CodexDynamicTool } from './codex-app-server';
import { classifyRuntimeRetry } from './agents/runtime-retry-policy';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';


type RecordValue = Record<string, unknown>;
export type CodexModelEvent = { phase: string; message: string; details: RecordValue };
type ModelEventHandler = (event: CodexModelEvent) => void | Promise<void>;
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown) => typeof value === 'string' ? value : '';

/** Protocol translation only. Codex owns history, compaction and the agent loop. */
export function codexResponsesInput(body: RecordValue) {
  const messages: ModelMessage[] = [];
  const names = new Map<string, string>();
  const pendingCalls = new Set<string>();
  const visuals: Exclude<UserContent, string>[] = [];
  type AssistantContent = Extract<ModelMessage, { role: 'assistant' }>['content'];
  const assistantParts = (content: AssistantContent) => typeof content === 'string'
    ? [{ type: 'text' as const, text: content }] : content;
  const appendAssistant = (content: AssistantContent) => {
    const previous = messages.at(-1);
    if (pendingCalls.size && previous?.role !== 'assistant') {
      throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, `Responses assistant item interrupts pending tool results: ${[...pendingCalls].join(', ')}`);
    }
    // Responses emits one item per call; chat providers expect the complete
    // assistant decision (including all parallel calls) before its results.
    if (previous?.role === 'assistant') previous.content = [...assistantParts(previous.content), ...assistantParts(content)];
    else messages.push({ role: 'assistant', content });
  };
  const text = (value: unknown) => typeof value === 'string' ? value : array(value).map(part => string(record(part).text)).filter(Boolean).join('\n');
  const parts = (value: unknown): UserContent => typeof value === 'string' ? value : array(value).flatMap((part): Exclude<UserContent, string> => {
    const item = record(part);
    if (item.type === 'input_text' || item.type === 'output_text') return [{ type: 'text' as const, text: string(item.text) }];
    if (item.type === 'input_image') return [{ type: 'image', image: string(item.image_url) }];
    if (item.type === 'input_file' || item.type === 'input_audio') throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, `Unsupported Responses input: ${item.type}; use the host file/media tools.`);
    return [];
  });
  if (body.instructions) messages.push({ role: 'system', content: string(body.instructions) });
  const inputs = typeof body.input === 'string' ? [{ role: 'user', content: body.input }] : array(body.input);
  for (const raw of inputs) {
    const item = record(raw);
    if (item.type === 'function_call') {
      const name = item.namespace ? `${string(item.namespace)}__${string(item.name)}` : string(item.name);
      const id = string(item.call_id);
      if (names.has(id)) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, `Responses contains duplicate tool call ID: ${id}`);
      appendAssistant([{ type: 'tool-call', toolCallId: id, toolName: name,
        input: JSON.parse(string(item.arguments) || '{}') }]);
      names.set(id, name);
      pendingCalls.add(id);
    } else if (item.type === 'function_call_output') {
      const id = string(item.call_id);
      const name = names.get(id);
      if (!name || !pendingCalls.has(id)) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, `Responses output has no pending matching call: ${id}`);
      const output = { type: 'text' as const, value: typeof item.output === 'string' ? item.output
        : array(item.output).filter(part => record(part).type === 'input_text').map(part => string(record(part).text)).join('\n') };
      messages.push({ role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName: name, output }] });
      pendingCalls.delete(id);
      // Some chat providers discard images nested inside tool results. User
      // image parts are portable; retain the originating call identity.
      const images = array(item.output).filter(part => record(part).type === 'input_image').map(part => string(record(part).image_url));
      if (images.length) visuals.push([
        { type: 'text', text: `[Tool visual evidence: ${name}, call ${id}] Images returned by this tool. Treat them as execution evidence, not a new user request.` },
        ...images.map(image => ({ type: 'image' as const, image })),
      ]);
      // A user image message between sibling tool results invalidates the
      // chat tool exchange. Attach every actual image after the full batch.
      if (!pendingCalls.size) for (const content of visuals.splice(0)) messages.push({ role: 'user', content });
    } else if (item.type === 'reasoning') {
      // Provider-specific encrypted reasoning is not portable to another model.
      const summary = text(item.summary);
      if (summary) appendAssistant(summary);
    } else if (['user', 'assistant', 'developer', 'system'].includes(string(item.role))) {
      if (item.role === 'assistant') appendAssistant(text(item.content));
      else {
        if (pendingCalls.size) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, `Responses ${item.role} item interrupts pending tool results: ${[...pendingCalls].join(', ')}`);
        if (item.role === 'developer' || item.role === 'system') messages.push({ role: 'system', content: text(item.content) });
        else messages.push({ role: 'user', content: parts(item.content) });
      }
    } else if (item.type && !['compaction', 'context_compaction'].includes(string(item.type))) {
      throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, `Unsupported Responses history item: ${item.type}`);
    } else if (item.type === 'compaction') {
      throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Encrypted remote compaction cannot be translated by the local model bridge.');
    }
  }
  if (pendingCalls.size) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, `Responses input is missing tool results: ${[...pendingCalls].join(', ')}`);
  return messages;
}

function responseTools(value: unknown, hostTools?: readonly CodexDynamicTool[]) {
  const tools: ToolSet = {};
  const names = new Map<string, { name: string; namespace?: string }>();
  const current = new Map(hostTools?.map(tool => [tool.name, tool]));
  const add = (raw: unknown, namespace?: string) => {
    const item = record(raw);
    if (item.type !== 'function') throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, `Unsupported built-in Responses tool: ${item.type}`);
    const name = string(item.name);
    if (current && !current.has(name)) return;
    const alias = namespace ? `${namespace}__${name}` : name;
    names.set(alias, { name, namespace });
    const updated = namespace === 'orbit' ? current.get(name) : undefined;
    tools[alias] = tool({ description: updated?.description ?? string(item.description), inputSchema: jsonSchema(record(updated?.inputSchema ?? item.parameters)) });
  };
  for (const raw of array(value)) {
    const item = record(raw);
    if (item.type === 'namespace') for (const nested of array(item.tools)) add(nested, string(item.name));
    // Model-specific built-ins (such as freeform apply_patch) are outside the host catalogue.
    // Do not advertise them to external models or let them bypass host validation and approvals.
    else if (item.type === 'function') add(raw);
  }
  return { tools, names };
}

export async function startCodexResponsesBridge(settings: ModelSettingsOverride, onModelEvent?: ModelEventHandler, hostTools?: readonly CodexDynamicTool[]) {
  const token = randomBytes(32).toString('hex');
  const active = new Set<AbortController>();
  let consecutiveFailures = 0;
  const server = createServer(async (request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(401).end(); return; }
    if (request.method !== 'POST' || !request.url?.replace(/\?.*$/, '').endsWith('/responses')) {
      response.writeHead(404).end(); return;
    }
    const controller = new AbortController();
    active.add(controller);
    response.on('close', () => { if (!response.writableEnded) controller.abort(); });
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 64 * 1024 * 1024) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Responses bridge request exceeds 64 MiB.');
        chunks.push(Buffer.from(chunk));
      }
      const body = record(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (body.previous_response_id) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'The local Responses bridge requires full input history.');
      await withModelSettings({ ...settings, model: string(body.model) || settings.model }, () => streamResponse(body, response, controller.signal, onModelEvent, hostTools, consecutiveFailures));
      consecutiveFailures = 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const decision = classifyRuntimeRetry(error, controller.signal);
      if (decision.retryable) consecutiveFailures += 1;
      const detail = record(error);
      let upstream: RecordValue = {};
      try { upstream = record(record(JSON.parse(string(detail.responseBody))).error); } catch { /* No upstream error envelope. */ }
      const upstreamCode = string(upstream.code) || string(detail.code) || string(record(detail.cause).code);
      const code = /context_length|context_window|prompt_too_long/i.test(upstreamCode)
        || /context (?:length|window).*(?:exceed|limit|too)|prompt.*too long/i.test(message)
        ? 'context_length_exceeded' : upstreamCode || ERROR_CODES.BRIDGE_ERROR;
      const providerStatus = Number(detail.statusCode);
      // Codex retries 429/5xx responses. A transport failure has no provider
      // status and must not be disguised as a terminal invalid request (400).
      const status = providerStatus >= 400 && providerStatus <= 599 ? providerStatus
        : decision.category === 'request-timeout' ? 504 : decision.category === 'network' ? 503 : 400;
      await onModelEvent?.({ phase: 'ai:runtime:recoverable-error', message: `模型供应商请求失败：${message}`,
        details: { error: codexRuntimeError(error), httpStatus: status, retryDecision: decision,
          failedAttempt: consecutiveFailures, terminal: false, retryManagedBy: 'codex-app-server' } });
      if (!response.headersSent) response.writeHead(status, { 'content-type': 'application/json',
        ...(decision.retryAfterMs !== undefined ? { 'retry-after': String(Math.ceil(decision.retryAfterMs / 1000)) } : {}),
      }).end(JSON.stringify({ error: { message, code, type: status >= 500 ? 'server_error' : 'invalid_request_error' } }));
      else if (!response.writableEnded && !response.destroyed) {
        response.write(`event: response.failed\ndata: ${JSON.stringify({ type: 'response.failed', response: {
          id: response.getHeader('x-request-id'), object: 'response', status: 'failed', output: [], error: { message, code },
        } })}\n\n`);
        response.end();
      }
    } finally { active.delete(controller); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Responses bridge did not bind a loopback port.');
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, token, close: async () => {
    for (const controller of active) controller.abort();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  } };
}

async function streamResponse(body: RecordValue, response: ServerResponse, signal: AbortSignal, onModelEvent?: ModelEventHandler, hostTools?: readonly CodexDynamicTool[], retryAttempt = 0) {
  const timeout = { totalMs: aiRuntimeRequestTimeoutMs(), ...aiRuntimeStreamTimeouts(aiRuntimeRequestTimeoutMs(), retryAttempt) };
  const watchdog = createAiRequestWatchdog(signal, timeout.totalMs);
  watchdog.waitForFirstChunk(timeout.firstChunkMs);
  try {
    await watchdog.run(streamResponseBody(body, response, watchdog, timeout, retryAttempt, onModelEvent, hostTools));
  } finally { watchdog.dispose(); }
}

async function streamResponseBody(body: RecordValue, response: ServerResponse,
  watchdog: ReturnType<typeof createAiRequestWatchdog>, timeout: ReturnType<typeof aiRuntimeStreamTimeouts> & { totalMs: number },
  retryAttempt: number, onModelEvent?: ModelEventHandler, hostTools?: readonly CodexDynamicTool[]) {
  const signal = watchdog.abortSignal;
  const startedAt = Date.now();
  const performance = createBrowserChatOutputPerformance(startedAt);
  const { tools, names } = responseTools(body.tools, hostTools);
  const id = `resp_${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  let sequence = 0;
  const output: RecordValue[] = [];
  const event = (type: string, payload: RecordValue) => {
    if (response.destroyed || response.writableEnded) return;
    response.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...payload })}\n\n`);
  };
  const envelope = (status: string, usage: unknown = null) => ({ id, object: 'response', created_at: created, model: body.model,
    status, output, error: null, incomplete_details: null, usage, parallel_tool_calls: true });
  const messages = codexResponsesInput(body);
  const sentTools = await Promise.all(Object.entries(tools).map(async ([name, definition]) => ({
    name, description: typeof definition.description === 'function' ? definition.description({ context: undefined }) : definition.description,
    inputSchema: await asSchema(definition.inputSchema).jsonSchema,
  })));
  const aiInputTokens = estimateRuntimeRequestContext({ messages, tools: sentTools }, runtimeContextWindowTokens(getModelSettings()));
  await onModelEvent?.({ phase: 'ai:runtime:request', message: '模型请求已发送', details: {
    modelRequestId: id, attempt: retryAttempt + 1, timeout, aiInputTokens, aiInput: { model: body.model, messages, tools: sentTools, reasoning: body.reasoning,
      temperature: body.temperature, toolChoice: body.tool_choice },
  } });
  const start = () => {
    if (response.headersSent) return;
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-request-id': id });
    event('response.created', { response: envelope('in_progress') });
    event('response.in_progress', { response: envelope('in_progress') });
  };
  const indexes = new Map<string, number>();
  const draftPublishedAt = new Map<string, number>();
  let firstOutputReceived = false;
  let performancePublishedAt = 0;
  const instructions = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n');
  const result = streamText({ model: getModel(), instructions,
    messages: messages.filter(message => message.role !== 'system'), tools: Object.keys(tools).length ? tools : undefined,
    toolChoice: body.tool_choice === 'none' ? 'none' : body.tool_choice === 'required' ? 'required' : 'auto',
    maxRetries: 0, abortSignal: signal, timeout,
    onChunk: ({ chunk }) => { watchdog.firstChunkReceived(chunk); watchdog.touch(); },
    onError: () => undefined,
    ...(typeof record(body.reasoning).effort === 'string' ? { reasoning: record(body.reasoning).effort as 'low' } : {}),
    ...(typeof body.temperature === 'number' ? { temperature: body.temperature } : {}),
  });
  for await (const part of result.fullStream) {
    signal.throwIfAborted();
    if (part.type === 'error') throw part.error;
    if (part.type !== 'start') start();
    if (!firstOutputReceived && ['text-delta', 'reasoning-delta', 'tool-input-start', 'tool-input-delta', 'tool-call'].includes(part.type)) {
      firstOutputReceived = true;
      await onModelEvent?.({ phase: 'ai:runtime:receiving', message: '正在接收模型输出', details: {
        modelRequestId: id, firstOutputElapsedMs: Date.now() - startedAt,
      } });
    }
    if (part.type === 'reasoning-start') {
      const index = output.length;
      indexes.set(part.id, index);
      const item = { id: `rs_${randomUUID()}`, type: 'reasoning', summary: [] as RecordValue[] };
      output.push(item);
      event('response.output_item.added', { output_index: index, item: { ...item, summary: [] } });
      item.summary.push({ type: 'summary_text', text: '' });
      event('response.reasoning_summary_part.added', { item_id: item.id, output_index: index, summary_index: 0, part: item.summary[0] });
    } else if (part.type === 'reasoning-delta') {
      performance.record(part.text);
      const index = indexes.get(part.id)!;
      const item = output[index];
      const summary = (item.summary as RecordValue[])[0];
      summary.text = string(summary.text) + part.text;
      event('response.reasoning_summary_text.delta', { item_id: item.id, output_index: index, summary_index: 0, delta: part.text });
    } else if (part.type === 'reasoning-end') {
      const index = indexes.get(part.id)!;
      const item = output[index];
      const summary = (item.summary as RecordValue[])[0];
      event('response.reasoning_summary_text.done', { item_id: item.id, output_index: index, summary_index: 0, text: summary.text });
      event('response.reasoning_summary_part.done', { item_id: item.id, output_index: index, summary_index: 0, part: summary });
      event('response.output_item.done', { output_index: index, item });
    } else if (part.type === 'text-start') {
      const index = output.length;
      indexes.set(part.id, index);
      const item = { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', status: 'in_progress', content: [] as RecordValue[] };
      output.push(item);
      event('response.output_item.added', { output_index: index, item: { ...item, content: [] } });
      item.content.push({ type: 'output_text', text: '', annotations: [] });
      event('response.content_part.added', { item_id: item.id, output_index: index, content_index: 0, part: item.content[0] });
    } else if (part.type === 'text-delta') {
      performance.record(part.text);
      const index = indexes.get(part.id)!;
      const item = output[index];
      const content = (item.content as RecordValue[])[0];
      content.text = string(content.text) + part.text;
      event('response.output_text.delta', { item_id: item.id, output_index: index, content_index: 0, delta: part.text });
    } else if (part.type === 'text-end') {
      const index = indexes.get(part.id)!;
      const item = output[index];
      const content = (item.content as RecordValue[])[0];
      item.status = 'completed';
      event('response.output_text.done', { item_id: item.id, output_index: index, content_index: 0, text: content.text });
      event('response.content_part.done', { item_id: item.id, output_index: index, content_index: 0, part: content });
      event('response.output_item.done', { output_index: index, item });
    } else if (part.type === 'tool-input-start') {
      const mapping = names.get(part.toolName);
      if (!mapping) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, `Model requested an unregistered tool: ${part.toolName}`);
      const index = output.length;
      indexes.set(part.id, index);
      const item = { id: `fc_${randomUUID()}`, type: 'function_call', call_id: part.id, ...mapping, arguments: '', status: 'in_progress' };
      output.push(item);
      event('response.output_item.added', { output_index: index, item });
    } else if (part.type === 'tool-input-delta') {
      performance.record(part.delta);
      const index = indexes.get(part.id)!;
      const item = output[index];
      item.arguments = string(item.arguments) + part.delta;
      event('response.function_call_arguments.delta', { item_id: item.id, output_index: index, delta: part.delta });
      if (item.name === 'finalResponse' && Date.now() - (draftPublishedAt.get(part.id) || 0) >= 32) {
        draftPublishedAt.set(part.id, Date.now());
        await onModelEvent?.({ phase: 'ai:runtime:stream', message: '正在生成回复', details: {
          kind: 'tool-input', modelRequestId: id, toolCallId: part.id, toolName: item.name, arguments: item.arguments,
        } });
      }
    } else if (part.type === 'tool-call') {
      let index = indexes.get(part.toolCallId);
      if (index === undefined) {
        const mapping = names.get(part.toolName);
        if (!mapping) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, `Model requested an unregistered tool: ${part.toolName}`);
        index = output.length;
        output.push({ id: `fc_${randomUUID()}`, type: 'function_call', call_id: part.toolCallId, ...mapping, arguments: '', status: 'in_progress' });
        indexes.set(part.toolCallId, index);
        event('response.output_item.added', { output_index: index, item: output[index] });
      }
      const item = output[index];
      item.arguments = JSON.stringify(part.input);
      item.status = 'completed';
      if (item.name === 'finalResponse') await onModelEvent?.({ phase: 'ai:runtime:stream', message: '正在生成回复', details: {
        kind: 'tool-input', modelRequestId: id, toolCallId: part.toolCallId, toolName: item.name, arguments: item.arguments,
      } });
      event('response.function_call_arguments.done', { item_id: item.id, output_index: index, arguments: item.arguments });
      event('response.output_item.done', { output_index: index, item });
    }
    if (['text-delta', 'reasoning-delta', 'tool-input-delta'].includes(part.type) && Date.now() - performancePublishedAt >= 160) {
      performancePublishedAt = Date.now();
      await onModelEvent?.({ phase: 'ai:runtime:stream', message: '正在接收模型输出', details: {
        kind: 'performance', modelRequestId: id, performance: performance.snapshot(),
      } });
    }
  }
  const finish = await result.finishReason;
  const usage = await result.usage;
  signal.throwIfAborted();
  if (!['stop', 'tool-calls', 'length', 'content-filter'].includes(finish)) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, `Model generation ended abnormally: ${finish}`);
  start();
  const status = finish === 'length' || finish === 'content-filter' ? 'incomplete' : 'completed';
  const completed = { ...envelope(status, { input_tokens: usage.inputTokens ?? 0, output_tokens: usage.outputTokens ?? 0,
    total_tokens: usage.totalTokens ?? 0, input_tokens_details: { cached_tokens: usage.inputTokenDetails.cacheReadTokens ?? 0 },
    output_tokens_details: { reasoning_tokens: usage.outputTokenDetails.reasoningTokens ?? 0 } }),
    incomplete_details: status === 'incomplete' ? { reason: finish === 'length' ? 'max_output_tokens' : 'content_filter' } : null };
  // This is provider evidence. Ordered UI cycles come from App Server item events only.
  await onModelEvent?.({ phase: 'ai:runtime:response', message: `模型供应商返回：${finish}`, details: {
    modelRequestId: id, aiOutput: { response: { body: completed, usage, finishReason: finish },
      usage: { ...usage, inputTokenDetails: { ...usage.inputTokenDetails }, outputTokenDetails: { ...usage.outputTokenDetails } }, performance: performance.finish({ usage,
      performance: { responseTimeMs: Date.now() - startedAt }, content: [] }),
      timings: { totalElapsedMs: Date.now() - startedAt, aiRequestElapsedMs: Date.now() - startedAt, toolCount: 0, toolElapsedMs: 0 } },
  } });
  event(status === 'completed' ? 'response.completed' : 'response.incomplete', { response: completed });
  response.end();
}

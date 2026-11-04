import { runtimeSetting } from '@/server/settings/runtime-configuration';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { resolveCodexCliPath } from './codex-cli';
import { appDataRoot } from '@/server/storage/paths';
import { startCodexResponsesBridge, type CodexModelEvent } from './codex-responses-bridge';
import { getModelSettings, type ModelSettingsOverride } from './model';
import { aiRuntimeRequestTimeoutMs } from './ai-sdk-runtime';
import { currentReasoningEffort } from './reasoning-scope';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';


export type CodexRecord = Record<string, unknown>;
export type CodexInput = { type: 'text'; text: string } | { type: 'localImage'; path: string } | { type: 'image'; url: string };
export type CodexToolOutput = { type: 'inputText'; text: string } | { type: 'inputImage'; imageUrl: string };
export type CodexToolCall = { threadId: string; turnId: string; callId: string; namespace?: string | null; tool: string; arguments: unknown };
export type CodexDynamicTool = { type: 'function'; name: string; description: string; inputSchema: unknown };
export class CodexRpcError extends Error {
  readonly code = ERROR_CODES.CODEX_RPC_FAILED;
  constructor(readonly rpcCode: number, message: string, readonly data?: unknown) { super(message); this.name = 'CodexRpcError'; }
}
const object = (value: unknown): CodexRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as CodexRecord : {};

/** One stdio connection; responses are resolved immediately, events are ordered. */
export class CodexAppServer {
  private serial = 0;
  private readonly pending = new Map<number, { resolve: (value: CodexRecord) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private eventQueue = Promise.resolve();
  private handler?: (method: string, params: CodexRecord, id?: number | string) => Promise<unknown>;
  private fatal?: Error;
  private stderr = '';
  private closed = false;
  private rejectTurn?: (error: Error) => void;
  readonly process: ChildProcessWithoutNullStreams;

  constructor(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) {
    this.process = spawn(command, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const lines = createInterface({ input: this.process.stdout });
    lines.on('line', line => {
      try {
        const message = object(JSON.parse(line));
        if (message.id !== undefined && !message.method) {
          const waiting = this.pending.get(Number(message.id));
          if (!waiting) return;
          this.pending.delete(Number(message.id)); clearTimeout(waiting.timer);
          const error = object(message.error);
          if (message.error) waiting.reject(new CodexRpcError(Number(error.code), String(error.message), error.data));
          else waiting.resolve(object(message.result));
          return;
        }
        this.eventQueue = this.eventQueue.then(async () => {
          const method = String(message.method);
          const params = object(message.params);
          const id = message.id as number | string | undefined;
          let result: unknown;
          if (this.handler) result = await this.handler(method, params, id);
          else if (id !== undefined) result = this.rejectRequest(method);
          if (id !== undefined) this.send({ id, result: result ?? this.rejectRequest(method) });
        }).catch(error => { this.fail(error instanceof Error ? error : new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, String(error))); });
      } catch (error) { this.fail(new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Invalid JSON from Codex App Server.', { cause: error })); }
    });
    this.process.stderr.on('data', chunk => { this.stderr = (this.stderr + String(chunk)).slice(-2000); });
    this.process.on('error', error => this.fail(error));
    this.process.on('exit', code => {
      if (!this.closed) this.fail(new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, `Codex App Server exited (${code}). ${this.stderr}`));
    });
    this.process.stdin.on('error', error => { if (!this.closed) this.fail(error); });
  }

  private rejectRequest(method: string) {
    if (method === 'item/tool/call') return { success: false, contentItems: [{ type: 'inputText', text: 'The host tool handler is unavailable; no action was executed.' }] };
    if (method === 'item/tool/requestUserInput') return { answers: {} };
    if (method === 'item/permissions/requestApproval') return { permissions: {}, scope: 'turn' };
    if (method === 'mcpServer/elicitation/request') return { action: 'decline', content: null };
    return { decision: 'decline' };
  }

  private fail(error: Error) {
    this.fatal ??= error;
    for (const waiting of this.pending.values()) { clearTimeout(waiting.timer); waiting.reject(error); }
    this.pending.clear();
    this.rejectTurn?.(error);
  }

  private send(message: unknown) {
    if (this.closed || this.fatal) throw this.fatal || new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Codex App Server connection is closed.');
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method: string, params: unknown, timeoutMs = 60000): Promise<CodexRecord> {
    if (this.fatal || this.closed) return Promise.reject(this.fatal || new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Codex App Server connection is closed.'));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, `Codex App Server ${method} timed out.`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ method, id, params }); } catch (error) {
        this.pending.delete(id); clearTimeout(timer); reject(error);
      }
    });
  }

  async initialize() {
    await this.request('initialize', { clientInfo: { name: 'orbit', title: 'Orbit', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    this.send({ method: 'initialized', params: {} });
  }

  async runTurn(params: CodexRecord, options: {
    signal?: AbortSignal;
    onEvent: (method: string, params: CodexRecord) => Promise<void>;
    onTool: (call: CodexToolCall) => Promise<{ success: boolean; contentItems: CodexToolOutput[] }>;
  }) {
    options.signal?.throwIfAborted();
    const done = Promise.withResolvers<CodexRecord>();
    // A failed start may happen before we await completion.
    void done.promise.catch(() => undefined);
    this.rejectTurn = done.reject;
    let turnId = '';
    const interrupt = () => {
      if (turnId) void this.request('turn/interrupt', { threadId: params.threadId, turnId }, 10000).catch(() => undefined);
      done.reject(options.signal?.reason || new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Codex turn interrupted.'));
    };
    this.handler = async (method, event, id) => {
      if (event.threadId && event.threadId !== params.threadId) return id === undefined ? undefined : this.rejectRequest(method);
      if (id !== undefined) {
        if (method === 'item/tool/call') {
          if (options.signal?.aborted) return this.rejectRequest(method);
          return options.onTool(event as unknown as CodexToolCall);
        }
        return this.rejectRequest(method);
      }
      if (method === 'turn/started') { turnId = String(object(event.turn).id); if (options.signal?.aborted) interrupt(); }
      await options.onEvent(method, event);
      if (method === 'turn/completed') done.resolve(object(event.turn));
    };
    options.signal?.addEventListener('abort', interrupt, { once: true });
    try {
      const started = await this.request('turn/start', params);
      turnId ||= String(object(started.turn).id || '');
      if (options.signal?.aborted) interrupt();
      return await done.promise;
    } finally {
      options.signal?.removeEventListener('abort', interrupt);
      // Wait for an in-flight host tool to finish journaling its outcome.
      await this.eventQueue;
      this.handler = undefined; this.rejectTurn = undefined;
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const waiting of this.pending.values()) { clearTimeout(waiting.timer); waiting.reject(new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Codex connection closed.')); }
    this.pending.clear();
    this.process.stdin.end();
    if (this.process.exitCode !== null) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        if (process.platform === 'win32' && this.process.pid) {
          const killer = spawn('taskkill.exe', ['/pid', String(this.process.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
          killer.on('error', () => this.process.kill());
        } else this.process.kill();
        resolve();
      }, 2000);
      this.process.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}

/** Read catalogue metadata only; Codex retains ownership of rollout/context history. */
export async function readCodexThreadTools(thread: CodexRecord, storageRoot: string): Promise<CodexDynamicTool[]> {
  const filePath = typeof thread.path === 'string' ? path.resolve(thread.path) : '';
  const relative = filePath ? path.relative(storageRoot, filePath) : '..';
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Codex rollout is outside the current user store.');
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const lines = createInterface({ input: stream });
  try {
    for await (const line of lines) {
      const metadata = object(JSON.parse(line));
      const payload = object(metadata.payload);
      if (metadata.type !== 'session_meta' || (payload.id ?? payload.session_id) !== thread.id) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Codex rollout metadata does not match the bound thread.');
      const catalogue = Array.isArray(payload.dynamic_tools) ? payload.dynamic_tools : [];
      return catalogue.flatMap(raw => {
        const tool = object(raw);
        return tool.type === 'namespace' && tool.name === 'orbit' && Array.isArray(tool.tools)
          ? tool.tools.filter(raw => object(raw).type === 'function') as CodexDynamicTool[] : [];
      });
    }
    throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Codex rollout metadata is missing.');
  } finally { lines.close(); stream.destroy(); }
}

/** Update host registration metadata before resume, preserving every history byte after it. */
export async function updateCodexThreadTools(thread: CodexRecord, storageRoot: string, tools: readonly CodexDynamicTool[]) {
  if (object(thread.status).type === 'active' || (Array.isArray(thread.turns) && thread.turns.some(turn => object(turn).status === 'inProgress'))) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Cannot update tools while the Codex thread has an active turn.');
  const root = await realpath(storageRoot), filePath = await realpath(String(thread.path || ''));
  const relative = path.relative(root, filePath);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Codex rollout is outside the current user store.');
  const temporary = `${filePath}.catalogue-${randomUUID()}.tmp`;
  async function* replaceMetadata() {
    let header = Buffer.alloc(0), found = false;
    for await (const raw of createReadStream(filePath)) {
      const chunk = Buffer.from(raw);
      if (found) { yield chunk; continue; }
      const newline = chunk.indexOf(10);
      if (newline < 0) { header = Buffer.concat([header, chunk]); continue; }
      header = Buffer.concat([header, chunk.subarray(0, newline)]);
      const metadata = object(JSON.parse(header.toString('utf8'))), payload = object(metadata.payload);
      if (metadata.type !== 'session_meta' || (payload.id ?? payload.session_id) !== thread.id) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Codex rollout metadata does not match the bound thread.');
      const catalogue = Array.isArray(payload.dynamic_tools) ? payload.dynamic_tools : [];
      payload.dynamic_tools = [...catalogue.filter(raw => !(object(raw).type === 'namespace' && object(raw).name === 'orbit')),
        { type: 'namespace', name: 'orbit', description: 'Orbit host tools', tools }];
      metadata.payload = payload;
      yield Buffer.from(`${JSON.stringify(metadata)}\n`); yield chunk.subarray(newline + 1); found = true;
    }
    if (!found) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Codex rollout metadata is missing.');
  }
  try {
    // This Codex release registers tools at thread/start only. Replace just the
    // host catalogue atomically; response items and compaction history stay exact.
    await pipeline(replaceMetadata(), createWriteStream(temporary, { flags: 'wx' }));
    await rename(temporary, filePath);
  } finally { await rm(temporary, { force: true }); }
}

export async function openCodexAppServer(input: { userId?: string; sessionId: string; scope: string; hostTools?: readonly CodexDynamicTool[];
  onModelEvent?: (event: CodexModelEvent) => void | Promise<void> }) {
  const settings = getModelSettings();
  const identity = createHash('sha256').update(input.userId || 'local').digest('hex').slice(0, 24);
  const codexHome = path.join(appDataRoot(), 'codex', identity);
  const cwd = path.join(codexHome, 'workspaces', createHash('sha256').update(`${input.sessionId}:${input.scope}`).digest('hex').slice(0, 24));
  await mkdir(cwd, { recursive: true });
  const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: codexHome };
  const native = settings.provider === 'codex';
  if (native) {
    const authPath = path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'auth.json');
    if (existsSync(authPath)) {
      const auth = await readFile(authPath);
      const digest = createHash('sha256').update(auth).digest('hex');
      const marker = path.join(codexHome, 'auth-source.sha256');
      const copied = await readFile(marker, 'utf8').catch(() => '');
      if (copied !== digest || !existsSync(path.join(codexHome, 'auth.json'))) {
        await writeFile(path.join(codexHome, 'auth.json'), auth, { mode: 0o600 });
        await writeFile(marker, digest);
      }
    }
  }
  const bridge = native ? undefined : await startCodexResponsesBridge({ ...settings, sessionId: input.sessionId,
    reasoningEffort: currentReasoningEffort() } as ModelSettingsOverride, input.onModelEvent, input.hostTools);
  const config: CodexRecord = {
    'features.shell_tool': false, 'features.unified_exec': false, 'features.multi_agent': false,
    'features.apps': false, 'features.browser_use': false, 'features.computer_use': false,
    'features.code_mode': false, 'features.code_mode_host': false, 'features.in_app_browser': false,
    web_search: 'disabled', sandbox_mode: 'read-only', approval_policy: 'untrusted',
    model: settings.model,
    // Unknown provider models inherit a small output budget. Long Chinese source
    // text was being cut out of otherwise complete dynamic-tool receipts.
    tool_output_token_limit: 32768,
  };
  const configuredWindow = settings.maxContextTokens || Number(runtimeSetting('AI_CONTEXT_WINDOW_TOKENS')) || (native ? undefined : 256000);
  if (configuredWindow && configuredWindow > 0) {
    config.model_context_window = Math.floor(configuredWindow);
    const ratio = Number(runtimeSetting('AI_CONTEXT_COMPRESSION_TRIGGER_RATIO')) || 0.85;
    config.model_auto_compact_token_limit = Math.floor(configuredWindow * Math.max(0.01, Math.min(0.99, ratio)));
  }
  if (bridge) {
    const retries = Math.max(0, Math.min(10, Math.floor(Number(runtimeSetting('AI_RUNTIME_REQUEST_RETRY_ATTEMPTS')) || 3) - 1));
    env.ORBIT_CODEX_BRIDGE_TOKEN = bridge.token;
    config.model_provider = 'orbit';
    config['model_providers.orbit'] = { name: 'Orbit model bridge', base_url: bridge.baseUrl, env_key: 'ORBIT_CODEX_BRIDGE_TOKEN',
      // Stream recovery also covers the initial HTTP request. Giving both
      // layers the same budget multiplies three configured attempts into nine.
      wire_api: 'responses', request_max_retries: 0, stream_max_retries: retries, stream_idle_timeout_ms: aiRuntimeRequestTimeoutMs() };
  }
  const codexPath = resolveCodexCliPath(runtimeSetting('CODEX_PATH'), process.cwd()) || 'codex';
  const args = ['app-server', '--listen', 'stdio://'];
  for (const [key, value] of Object.entries(config)) args.push('-c', `${key}=${toml(value)}`);
  const command = /\.[cm]?js$/i.test(codexPath) ? process.execPath : codexPath;
  if (command === process.execPath) args.unshift(codexPath);
  const client = new CodexAppServer(command, args, { cwd, env });
  try { await client.initialize(); } catch (error) { await client.close(); await bridge?.close(); throw error; }
  return { client, cwd, storageRoot: codexHome, modelProvider: native ? 'openai' : 'orbit', config, close: async () => { await client.close(); await bridge?.close(); } };
}

// Codex -c accepts TOML, not JSON object literals.
function toml(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(toml).join(', ')}]`;
  if (value && typeof value === 'object') return `{ ${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)} = ${toml(item)}`).join(', ')} }`;
  return JSON.stringify(value);
}

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { release, tmpdir } from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { spawnTerminal, type TerminalProcess } from '../../../runtime/terminal/pty-host-client.cjs';
import { managedProcessEnvironment } from '../../runtime.ts';
import { normalizeBoundedInteger, type CapabilityRunContext, type CapabilityExecutionContext } from '../../index.ts';
import { createTerminalCapability, type TerminalOperations, type TerminalResult, type TerminalSummary, type TerminalEvent, type TerminalCommand } from './index.ts';
import { terminalShellInvocation, terminalCommandInvocation, type TerminalShell } from './shell-integration.ts';
import { retainTerminalOutput, splitTerminalOutput, terminalGeometryAt, terminalGeometrySequence, type TerminalGeometry } from './geometry.ts';
export type { TerminalShell } from './shell-integration.ts';

const plainOutput = (value: string) => {
  const output = splitTerminalOutput(value).flatMap(part => 'output' in part ? [part.output] : []).join('');
  return stripVTControlCharacters(output.replace(new RegExp('\\x1b\\[[0-?]*[ -/]*[@-~]', 'g'), ''));
};

export type NodeTerminalOptions = {
  cwd: string; shell?: TerminalShell; env?: NodeJS.ProcessEnv;
  timeoutMs?: number; maxOutputChars?: number; maxProcesses?: number;
};
type TerminalSession = {
  summary: TerminalSummary; process: TerminalProcess; directory: string; nonce: string;
  output: string; outputGeometry: TerminalGeometry; pending: string; suppressEcho: boolean; awaitingStart: boolean; files: string[];
  pendingGeometry: Array<{ offset: number; geometry: TerminalGeometry }>;
  timer?: ReturnType<typeof setTimeout>; interruptTimer?: ReturnType<typeof setTimeout>;
  interruption?: 'interrupted' | 'timed_out'; closed: Promise<void>;
};
export interface NodeTerminalOperations extends TerminalOperations {
  configure(options: NodeTerminalOptions): void;
  list(): TerminalSummary[];
  read(terminalId: string, cursor?: number, raw?: boolean): TerminalResult;
  subscribe(listener: (event: TerminalEvent) => void): () => void;
  dispose(): Promise<void>;
}

export function nodeTerminalOptions(context: CapabilityRunContext): NodeTerminalOptions {
  const config = context.configuration;
  return {
    cwd: config.AGENT_TERMINAL_CWD?.trim() || process.cwd(),
    shell: (config.AGENT_TERMINAL_SHELL || 'auto') as TerminalShell,
    timeoutMs: normalizeBoundedInteger(config.AGENT_TERMINAL_TIMEOUT_MS, 0, 0, 3600000),
    maxOutputChars: normalizeBoundedInteger(config.AGENT_TERMINAL_MAX_OUTPUT_CHARS, 50000, 1000, 500000),
    maxProcesses: normalizeBoundedInteger(config.AGENT_TERMINAL_MAX_PROCESSES, 4, 1, 16),
  };
}

export function createNodeTerminalOperations(initialOptions: NodeTerminalOptions): NodeTerminalOperations {
  let options = initialOptions;
  const sessions = new Map<string, TerminalSession>();
  const events = new EventEmitter();
  events.setMaxListeners(100);
  let disposed = false, creating = 0;
  let disposal: Promise<void> | undefined;
  const emit = (event: TerminalEvent) => events.emit('update', event);
  const copy = (s: TerminalSession): TerminalSummary => ({ ...s.summary, command: s.summary.command && { ...s.summary.command } });
  const isClosed = (s: TerminalSession) => s.summary.status === 'closed';
  const state = (s: TerminalSession) => emit({ type: 'state', terminal: copy(s) });
  const get = (id: string) => {
    const s = sessions.get(id);
    if (!s) throw new Error('Terminal not found in this workspace. Use list to discover current terminals.');
    return s;
  };
  const cleanupCommand = (s: TerminalSession) => {
    if (s.timer) clearTimeout(s.timer);
    if (s.interruptTimer) clearTimeout(s.interruptTimer);
    s.timer = undefined; s.interruptTimer = undefined;
    const files = s.files; s.files = [];
    void Promise.all(files.map(file => rm(file, { force: true }))).catch(() => undefined);
  };
  const complete = (s: TerminalSession, exitCode: number) => {
    if (s.summary.command?.status === 'running') {
      s.summary.command = { ...s.summary.command,
        status: s.interruption || (exitCode === 0 ? 'succeeded' : 'failed'),
        exitCode: s.interruption ? 130 : exitCode, completedAt: new Date().toISOString() };
    }
    s.interruption = undefined; s.suppressEcho = false; s.awaitingStart = false; cleanupCommand(s);
  };
  const append = (s: TerminalSession, output: string, geometry = false) => {
    if (!output || s.suppressEcho && !geometry) return;
    const startCursor = s.summary.cursor;
    s.summary.cursor += output.length;
    const retained = retainTerminalOutput({ output: s.output, geometry: s.outputGeometry }, output,
      normalizeBoundedInteger(options.maxOutputChars, 50000, 1000, 500000));
    s.output = retained.output; s.outputGeometry = retained.geometry;
    s.summary.startCursor = s.summary.cursor - s.output.length;
    emit({ type: 'output', terminalId: s.summary.terminalId, output, startCursor, cursor: s.summary.cursor });
  };
  const consumePending = (s: TerminalSession, length: number, keepOutput = true) => {
    let start = 0;
    while (s.pendingGeometry.length && s.pendingGeometry[0].offset <= length) {
      const { offset, geometry } = s.pendingGeometry.shift()!;
      if (keepOutput) append(s, s.pending.slice(start, offset));
      append(s, terminalGeometrySequence(geometry), true);
      start = offset;
    }
    if (keepOutput) append(s, s.pending.slice(start, length));
    s.pending = s.pending.slice(length);
    for (const marker of s.pendingGeometry) marker.offset -= length;
  };
  const consume = (s: TerminalSession, data: string) => {
    const prefix = `\x1b]777;orbit;${s.nonce};`;
    s.pending += data;
    for (;;) {
      const start = s.pending.indexOf(prefix);
      if (start < 0) {
        let keep = Math.min(prefix.length - 1, s.pending.length);
        while (keep && !prefix.startsWith(s.pending.slice(-keep))) keep--;
        consumePending(s, s.pending.length - keep);
        return;
      }
      consumePending(s, start);
      const end = s.pending.indexOf('\x07', prefix.length);
      if (end < 0) {
        if (s.pending.length > 16384) consumePending(s, s.pending.length);
        return;
      }
      const [kind, code, cwd] = s.pending.slice(prefix.length, end).split(';');
      // A resize can arrive while the private shell marker is split across IPC
      // chunks. Preserve its boundary while filtering the shell marker itself.
      consumePending(s, end + 1, false);
      if (kind === 'start') {
        s.suppressEcho = false; s.awaitingStart = false;
        if (s.interruption) s.process.write('\x03');
      }
      if (kind === 'ready') {
        const exitCode = Number(code);
        if (Number.isInteger(exitCode) && cwd) {
          s.summary.cwd = Buffer.from(cwd, 'base64').toString('utf8');
          complete(s, exitCode);
          s.summary.status = 'ready'; state(s);
        }
      }
    }
  };
  const interrupt = (s: TerminalSession, status: 'interrupted' | 'timed_out' = 'interrupted') => {
    if (s.summary.status === 'closed') return;
    s.interruption = status;
    // A Ctrl+C sent while the shell is still accepting the invocation line can
    // cancel its echo yet leave the command queued. Deliver it at the start
    // marker when that command actually owns the foreground.
    if (!s.awaitingStart) s.process.write('\x03');
    // Ctrl+C normally returns to the same shell. A stuck foreground process
    // gets the terminal closed instead of being reported as successfully stopped.
    if (s.summary.command?.status === 'running' && !s.interruptTimer) {
      s.interruptTimer = setTimeout(() => { if (s.summary.command?.status === 'running') kill(s); }, 3000);
    }
  };
  const kill = (s: TerminalSession) => {
    if (isClosed(s)) return;
    s.process.kill();
  };
  const wait = async (s: TerminalSession, milliseconds: number, context: CapabilityExecutionContext, outputCursor?: number) => {
    context.abortSignal?.throwIfAborted();
    if (s.summary.status !== 'running' && s.summary.status !== 'starting') return;
    let lastReport = 0;
    await new Promise<void>((resolve, reject) => {
      const finish = () => { clearTimeout(timer); events.off('update', update); context.abortSignal?.removeEventListener('abort', abort); resolve(); };
      const abort = () => { finish(); reject(context.abortSignal?.reason || new Error('Terminal wait cancelled.')); };
      const update = (event: TerminalEvent) => {
        if (event.type === 'reset') { finish(); return; }
        if (event.type === 'deleted' || (event.type === 'state' ? event.terminal.terminalId : event.terminalId) !== s.summary.terminalId) return;
        if (context.reportProgress && Date.now() - lastReport >= 200) {
          lastReport = Date.now();
          void Promise.resolve(context.reportProgress({ phase: 'terminal:output', message: `${s.summary.name}: ${s.summary.status}`,
            data: { terminalId: s.summary.terminalId, cursor: s.summary.cursor, output: plainOutput(s.output.slice(-4000)) } })).catch(() => undefined);
        }
        if (s.summary.status !== 'running' && s.summary.status !== 'starting' || outputCursor !== undefined && s.summary.cursor > outputCursor) finish();
      };
      const timer = setTimeout(finish, milliseconds);
      events.on('update', update);
      context.abortSignal?.addEventListener('abort', abort, { once: true });
      if (context.abortSignal?.aborted) abort();
    });
  };
  const close = async (s: TerminalSession) => {
    if (s.summary.status === 'closed') return;
    s.interruption = 'interrupted'; kill(s);
    await s.closed;
  };

  const operations: NodeTerminalOperations = {
    configure(next) { options = next; },
    list() { return [...sessions.values()].map(copy); },
    subscribe(listener) { events.on('update', listener); return () => { events.off('update', listener); }; },
    read(id, cursor = 0, raw = false) {
      const s = get(id);
      const offset = Math.max(s.summary.startCursor, Math.min(cursor, s.summary.cursor));
      const output = s.output.slice(offset - s.summary.startCursor);
      return { terminal: copy(s), output: raw ? output : plainOutput(output),
        ...(raw ? { outputGeometry: terminalGeometryAt(s.output, s.outputGeometry, offset - s.summary.startCursor) } : {}),
        cursor: s.summary.cursor, truncated: cursor < s.summary.startCursor };
    },
    async execute(request, context) {
      if (disposed) throw new Error('Terminal manager is closed.');
      context.abortSignal?.throwIfAborted();
      if (request.action === 'list') return { terminals: operations.list() };
      if (request.action === 'create') {
        const max = normalizeBoundedInteger(options.maxProcesses, 4, 1, 16);
        if (creating + [...sessions.values()].filter(s => s.summary.status !== 'closed').length >= max) throw new Error(`At most ${max} terminals may be open. Close one first.`);
        if (sessions.size + creating >= 64) throw new Error('Delete a closed terminal before creating more terminals.');
        creating++;
        let directory: string | undefined;
        let s: TerminalSession | undefined;
        try {
          const cwd = await realpath(path.resolve(options.cwd, request.cwd || '.'));
          if (!(await stat(cwd)).isDirectory()) throw new Error('Terminal cwd must be a directory.');
          const configured = options.shell || 'auto';
          const shell = configured === 'auto' ? (process.platform === 'win32' ? 'powershell' : 'bash') : configured;
          if (!['powershell', 'pwsh', 'bash'].includes(shell)) throw new Error('Unsupported terminal shell.');
          if (process.platform === 'win32' && shell === 'bash') throw new Error('Windows terminals require PowerShell or pwsh for process-tree ownership.');
          directory = await mkdtemp(path.join(tmpdir(), 'orbit-terminal-'));
          const nonce = randomUUID();
          const invocation = await terminalShellInvocation(shell, directory, nonce);
          context.abortSignal?.throwIfAborted();
          if (disposed) throw new Error('Terminal manager is closed.');
          const cols = request.cols || 100, rows = request.rows || 30;
          const child = await spawnTerminal(invocation.executable, invocation.args, {
            cwd, cols, rows, name: 'xterm-256color',
            env: Object.fromEntries(Object.entries(managedProcessEnvironment(options.env || process.env)).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
          });
          let windowsPty: TerminalSummary['windowsPty'];
          if (process.platform === 'win32') {
            const version = /(\d+)\.(\d+)\.(\d+)/.exec(release());
            const buildNumber = version ? Number(version[3]) : 0;
            // Match node-pty's host-build selection; useConptyDll does not force ConPTY.
            windowsPty = { backend: buildNumber >= 18309 ? 'conpty' : 'winpty',
              ...(Number.isSafeInteger(buildNumber) && buildNumber > 0 ? { buildNumber } : {}) };
          }
          let closed!: () => void;
          s = { summary: { terminalId: randomUUID(), name: request.name || `Terminal ${sessions.size + 1}`,
            shell, cwd, pid: child.pid, status: 'starting', createdAt: new Date().toISOString(),
            cols, rows, exitCode: null, cursor: 0, startCursor: 0, ...(windowsPty ? { windowsPty } : {}) },
            process: child, directory, nonce, pending: '', pendingGeometry: [], output: '', outputGeometry: { cols, rows }, suppressEcho: false, awaitingStart: false, files: [],
            closed: new Promise(resolve => { closed = resolve; }) };
          const current = s;
          sessions.set(current.summary.terminalId, current);
          child.onData(data => consume(current, data));
          child.onResize(geometry => {
            current.summary.cols = geometry.cols; current.summary.rows = geometry.rows;
            current.pendingGeometry.push({ offset: current.pending.length, geometry });
            consume(current, '');
            state(current);
          });
          child.onExit(event => {
            consumePending(current, current.pending.length);
            complete(current, event.exitCode); current.summary.status = 'closed'; current.summary.exitCode = event.exitCode;
            state(current); closed();
          });
          state(current);
          append(current, terminalGeometrySequence({ cols, rows }), true);
          if (disposed) throw new Error('Terminal manager is closed.');
          await wait(current, 15000, context);
          if (current.summary.status !== 'ready') throw new Error(`Terminal could not initialize: ${stripVTControlCharacters(current.output).slice(-2000)}`);
          return operations.read(current.summary.terminalId);
        } catch (error) {
          if (s) { await close(s); sessions.delete(s.summary.terminalId); emit({ type: 'deleted', terminalId: s.summary.terminalId }); }
          if (directory) await rm(directory, { recursive: true, force: true });
          throw error;
        } finally { creating--; events.emit('creation-settled'); }
      }
      const s = get(request.terminalId);
      if (request.action === 'delete') {
        await close(s); await rm(s.directory, { recursive: true, force: true });
        sessions.delete(request.terminalId); emit({ type: 'deleted', terminalId: request.terminalId });
        return { deleted: request.terminalId };
      }
      if (request.action === 'close') { await close(s); return operations.read(request.terminalId, s.summary.cursor); }
      if (request.action === 'read') return operations.read(request.terminalId, request.cursor);
      if (request.action === 'rename') { s.summary.name = request.name; state(s); return { terminal: copy(s) }; }
      if (request.action === 'wait') {
        await wait(s, request.yieldMs ?? 30000, context);
        return operations.read(request.terminalId, request.cursor);
      }
      if (s.summary.status === 'closed') throw new Error('Terminal is closed. Create a new terminal.');
      if (request.action === 'resize') {
        await s.process.resize(request.cols, request.rows);
      } else if (request.action === 'interrupt') interrupt(s);
      else if (request.action === 'write') {
        // Opening/focusing a terminal sends device and focus replies through
        // the same input stream as keystrokes. Only submitting a shell line
        // starts a command; rendering a terminal must never make it busy.
        if (s.summary.status === 'ready' && /[\r\n]/.test(request.input)) {
          s.summary.status = 'running';
          s.summary.command = { id: randomUUID(), command: '[interactive input]', startedAt: new Date().toISOString(), status: 'running', exitCode: null, timeoutMs: 0 };
          state(s);
        }
        s.process.write(request.input);
      } else if (request.action === 'run') {
        if (s.summary.status !== 'ready') throw new Error('Terminal is busy. Wait, send interactive input, interrupt it, or create another terminal.');
        const cursor = s.summary.cursor;
        const command: TerminalCommand = { id: randomUUID(), command: request.command, startedAt: new Date().toISOString(),
          status: 'running', exitCode: null, timeoutMs: request.timeoutMs ?? normalizeBoundedInteger(options.timeoutMs, 0, 0, 3600000) };
        s.summary.command = command; s.summary.status = 'running'; s.awaitingStart = true; state(s);
        const abort = () => { if (s.summary.command?.id === command.id && s.summary.command.status === 'running') interrupt(s); };
        try {
          const invocation = await terminalCommandInvocation(s.summary.shell, s.directory, s.nonce, command.id, request.command);
          s.files = invocation.files;
          context.abortSignal?.throwIfAborted();
          if (isClosed(s)) throw new Error('Terminal was closed before the command started.');
          if (s.interruption) { complete(s, 130); s.summary.status = 'ready'; state(s); return operations.read(request.terminalId, cursor); }
          append(s, request.command + '\r\n'); s.suppressEcho = true;
          s.process.write(invocation.input);
          if (command.timeoutMs > 0) s.timer = setTimeout(() => interrupt(s, 'timed_out'), command.timeoutMs);
          context.abortSignal?.addEventListener('abort', abort, { once: true });
          await wait(s, request.yieldMs ?? 1000, context);
          return operations.read(request.terminalId, cursor);
        } catch (error) {
          if (context.abortSignal?.aborted) abort();
          else if (s.summary.command?.id === command.id && s.summary.command.status === 'running') {
            complete(s, 1); if (!isClosed(s)) s.summary.status = 'ready'; state(s);
          }
          throw error;
        } finally { context.abortSignal?.removeEventListener('abort', abort); }
      }
      return { terminal: copy(s) };
    },
    async health() { return disposed ? { status: 'unhealthy', message: 'Terminal manager is closed.' } : { status: 'healthy', details: { terminals: sessions.size, transport: 'pty' } }; },
    dispose() {
      if (disposal) return disposal;
      disposed = true;
      disposal = (async () => {
      if (creating) await new Promise<void>(resolve => {
        const done = () => { if (!creating) { events.off('creation-settled', done); resolve(); } };
        events.on('creation-settled', done); done();
      });
      await Promise.all([...sessions.values()].map(async s => {
        await close(s); await rm(s.directory, { recursive: true, force: true });
        sessions.delete(s.summary.terminalId); emit({ type: 'deleted', terminalId: s.summary.terminalId });
      }));
      emit({ type: 'reset' });
      sessions.clear(); events.removeAllListeners();
      })();
      return disposal;
    },
  };
  return operations;
}

export function createNodeTerminalCapability(options: { cwd?: string | ((context: CapabilityRunContext) => string); env?: NodeJS.ProcessEnv } = {}) {
  return createTerminalCapability({ createOperations(context) {
    const cwd = typeof options.cwd === 'function' ? options.cwd(context) : options.cwd;
    return createNodeTerminalOperations({ ...nodeTerminalOptions(context), ...(cwd ? { cwd } : {}), env: options.env });
  } });
}

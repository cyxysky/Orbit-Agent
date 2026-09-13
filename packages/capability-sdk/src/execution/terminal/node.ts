import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { managedProcessEnvironment } from '../../runtime.ts';
import { normalizeBoundedInteger, type CapabilityRunContext } from '../../index.ts';
import { createTerminalCapability, type TerminalOperations, type TerminalResult, type TerminalStatus } from './index.ts';
import { windowsTerminalJobSetup } from './windows-job.ts';
import { terminateProcessTree } from '../process.ts';

export type TerminalShell = 'auto' | 'powershell' | 'pwsh' | 'bash' | 'sh';
export type NodeTerminalOptions = {
  cwd: string;
  shell?: TerminalShell;
  /** Environment is host-controlled; command arguments cannot override it. */
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxOutputChars?: number;
  maxProcesses?: number;
};
type ProcessSession = {
  id: string; child: ChildProcessWithoutNullStreams; cwd: string;
  status: TerminalStatus; exitCode: number | null; signal: string | null;
  stdout: string; stderr: string; truncated: boolean; error?: string;
  finished: boolean; closed: Promise<void>; timer?: ReturnType<typeof setTimeout>;
};

function shellInvocation(shell: Exclude<TerminalShell, 'auto'>, command: string) {
  if (shell === 'powershell' || shell === 'pwsh') {
    const script = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
${process.platform === 'win32' ? windowsTerminalJobSetup : ''}
try {
${command}
  if (-not $?) { if ($LASTEXITCODE) { exit $LASTEXITCODE }; exit 1 }
} catch { [Console]::Error.WriteLine($_.ToString()); exit 1 }
`;
    return { executable: shell === 'powershell' ? 'powershell.exe' : 'pwsh', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')] };
  }
  return { executable: shell, args: shell === 'bash' ? ['--noprofile', '--norc', '-c', command] : ['-c', command] };
}

function terminate(session: ProcessSession, status: 'cancelled' | 'timed_out', message: string) {
  if (session.finished || session.status !== 'running') return;
  session.status = status;
  session.error = message;
  terminateProcessTree(session.child);
}

async function waitForOutput(session: ProcessSession, milliseconds: number, signal?: AbortSignal) {
  const abort = () => terminate(session, 'cancelled', 'Terminal operation cancelled.');
  signal?.addEventListener('abort', abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (signal?.aborted) abort();
    if (!session.finished && !signal?.aborted && milliseconds > 0) {
      await Promise.race([session.closed, new Promise<void>(resolve => { timer = setTimeout(resolve, milliseconds); })]);
    }
    if (signal?.aborted) {
      await session.closed;
      signal.throwIfAborted();
    }
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export function createNodeTerminalOperations(options: NodeTerminalOptions): TerminalOperations {
  const cwd = path.resolve(options.cwd);
  const configuredShell = options.shell || 'auto';
  if (!['auto', 'powershell', 'pwsh', 'bash', 'sh'].includes(configuredShell)) throw new Error('Unsupported terminal shell.');
  const shell = configuredShell === 'auto' ? (process.platform === 'win32' ? 'powershell' : 'bash') : configuredShell;
  if (process.platform === 'win32' && shell !== 'powershell' && shell !== 'pwsh') {
    throw new Error('Windows terminal requires powershell or pwsh for process-tree lifecycle management.');
  }
  const timeoutMs = normalizeBoundedInteger(options.timeoutMs, 120000, 1000, 3600000);
  const maximum = normalizeBoundedInteger(options.maxOutputChars, 50000, 1000, 500000);
  const maxProcesses = normalizeBoundedInteger(options.maxProcesses, 4, 1, 16);
  const sessions = new Map<string, ProcessSession>();
  let disposed = false;

  const snapshot = (session: ProcessSession): TerminalResult => {
    const result = {
      sessionId: session.id, shell, cwd: session.cwd, status: session.status,
      exitCode: session.exitCode, signal: session.signal, stdout: session.stdout,
      stderr: session.stderr, truncated: session.truncated,
      ...(session.error ? { error: session.error } : {}),
    };
    session.stdout = ''; session.stderr = ''; session.truncated = false;
    return result;
  };

  return {
    async execute(request, context) {
      if (disposed) throw new Error('Terminal runtime has been disposed.');
      context.abortSignal?.throwIfAborted();
      let session: ProcessSession;
      if (request.action === 'run') {
        const directory = await realpath(path.resolve(cwd, request.cwd || '.'));
        if (!(await stat(directory)).isDirectory()) throw new Error('Terminal cwd must be a directory.');
        context.abortSignal?.throwIfAborted();
        // Check after filesystem awaits so concurrent direct callers share the limit.
        if (disposed) throw new Error('Terminal runtime has been disposed.');
        if ([...sessions.values()].filter(item => !item.finished).length >= maxProcesses) {
          throw new Error(`Terminal already has ${maxProcesses} active processes. Read or stop one first.`);
        }
        // Bound retained process metadata as well as each process's output.
        while (sessions.size >= 64) {
          const completed = [...sessions.values()].find(item => item.finished);
          if (!completed) throw new Error('Terminal process session limit reached.');
          sessions.delete(completed.id);
        }
        const invocation = shellInvocation(shell, request.command);
        const child = spawn(invocation.executable, invocation.args, {
          cwd: directory, env: managedProcessEnvironment(options.env || process.env), windowsHide: true, shell: false,
          detached: process.platform !== 'win32', stdio: 'pipe',
        });
        let finish!: () => void;
        session = {
          id: randomUUID(), child, cwd: directory, status: 'running', exitCode: null,
          signal: null, stdout: '', stderr: '', truncated: false, finished: false,
          closed: new Promise<void>(resolve => { finish = resolve; }),
        };
        sessions.set(session.id, session);
        const current = session;
        const append = (stream: 'stdout' | 'stderr', chunk: string) => {
          // Split the total budget between streams so neither hides the other.
          const limit = Math.floor(maximum / 2);
          const value = current[stream] + chunk;
          if (value.length > limit) current.truncated = true;
          current[stream] = value.slice(-limit);
        };
        child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => append('stdout', chunk));
        child.stderr.on('data', (chunk: string) => append('stderr', chunk));
        child.stdin.on('error', error => { current.error ||= error.message; });
        child.once('error', error => { current.status = 'failed'; current.error = error.message; });
        const abort = () => terminate(current, 'cancelled', 'Terminal run cancelled.');
        context.abortSignal?.addEventListener('abort', abort, { once: true });
        child.once('close', (code, signal) => {
          current.finished = true;
          current.exitCode = code;
          current.signal = signal;
          if (current.status === 'running') current.status = code === 0 ? 'exited' : 'failed';
          if (current.timer) clearTimeout(current.timer);
          context.abortSignal?.removeEventListener('abort', abort);
          finish();
        });
        const duration = Math.min(timeoutMs, request.timeoutMs ?? timeoutMs);
        current.timer = setTimeout(() => terminate(current, 'timed_out', `Command exceeded ${duration}ms.`), duration);
        if (request.keepStdinOpen) {
          if (request.stdin) child.stdin.write(request.stdin);
        } else child.stdin.end(request.stdin);
        if (context.abortSignal?.aborted) abort();
      } else {
        const found = sessions.get(request.sessionId);
        if (!found) throw new Error('Unknown terminal sessionId for this runtime.');
        session = found;
        if (request.action === 'stop') {
          terminate(session, 'cancelled', 'Stopped by the host.');
          await session.closed;
        } else if (request.action === 'write') {
          if (session.finished || session.child.stdin.destroyed || session.child.stdin.writableEnded) {
            throw new Error('Terminal stdin is closed. Start the program with keepStdinOpen=true to send input.');
          }
          const current = session;
          const abort = () => terminate(current, 'cancelled', 'Terminal input cancelled.');
          context.abortSignal?.addEventListener('abort', abort, { once: true });
          try {
            await new Promise<void>((resolve, reject) => {
              current.child.stdin.write(request.stdin, error => error ? reject(error) : resolve());
            });
            if (request.closeStdin) current.child.stdin.end();
          } finally { context.abortSignal?.removeEventListener('abort', abort); }
        }
      }
      await waitForOutput(session, request.action === 'stop' ? 0 : request.yieldMs ?? 1000, context.abortSignal);
      return snapshot(session);
    },
    async health() {
      if (disposed) return { status: 'unhealthy', message: 'Terminal runtime has been disposed.' };
      try {
        if (!(await stat(cwd)).isDirectory()) throw new Error('Terminal cwd is not a directory.');
        return { status: 'healthy', details: { cwd, shell, maxProcesses } };
      } catch (error) { return { status: 'unhealthy', message: error instanceof Error ? error.message : String(error) }; }
    },
    async dispose() {
      disposed = true;
      const pending = [...sessions.values()];
      for (const session of pending) terminate(session, 'cancelled', 'Terminal runtime disposed.');
      await Promise.all(pending.map(session => session.closed));
      sessions.clear();
    },
  };
}

export function createNodeTerminalCapability(options: {
  cwd?: string | ((context: CapabilityRunContext) => string);
  env?: NodeJS.ProcessEnv;
} = {}) {
  return createTerminalCapability({
    createOperations(context) {
      const configuration = context.configuration;
      const cwd = typeof options.cwd === 'function' ? options.cwd(context) : options.cwd;
      return createNodeTerminalOperations({
        cwd: cwd || configuration.AGENT_TERMINAL_CWD?.trim() || process.cwd(),
        shell: (configuration.AGENT_TERMINAL_SHELL || 'auto') as TerminalShell,
        env: options.env,
        timeoutMs: normalizeBoundedInteger(configuration.AGENT_TERMINAL_TIMEOUT_MS, 120000, 1000, 3600000),
        maxOutputChars: normalizeBoundedInteger(configuration.AGENT_TERMINAL_MAX_OUTPUT_CHARS, 50000, 1000, 500000),
        maxProcesses: normalizeBoundedInteger(configuration.AGENT_TERMINAL_MAX_PROCESSES, 4, 1, 16),
      });
    },
  });
}

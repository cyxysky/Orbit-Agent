import { spawn, type ChildProcess } from 'node:child_process';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { stopProcessTree } from '../../server/process-tree.cjs';
import { recoverExecutionTasks } from './execution-recovery';
import { setBrowserChatExecutionOwner, type ExecutionTask } from '@/server/runtime/execution-ownership';
import { authorizeInterrupt, isInterruptRequest } from './interrupt-authorization';

const executionPrefixes = ['/api/browser-chat', '/api/embed/browser-chat', '/api/automation', '/api/communication',
  '/api/admin/ai-operations/runtime', '/api/debug', '/api/settings/integrations', '/api/settings/sensitive-data', '/api/metrics', '/api/system/shutdown'];
export function executionRequest(pathname: string, method = 'GET') {
  // Database projections must remain reachable when Agent's event loop is busy.
  // Keep preview, selection and mutations with their live execution registry.
  if (method === 'GET' || method === 'HEAD') {
    if (['/api/browser-chat', '/api/browser-chat/bootstrap', '/api/browser-chat/tools'].includes(pathname)) return false;
    if (/^\/api\/browser-chat\/[^/]+\/(?:state|history|logs|context)$/.test(pathname)) return false;
  }
  return executionPrefixes.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`) || prefix === '/api/settings/sensitive-data' && pathname.startsWith(prefix));
}

type Worker = { child: ChildProcess; port: number; ready: Promise<void>; tasks: Map<string, ExecutionTask> };
function killTree(child: ChildProcess) { void stopProcessTree(child, { force: true }); }

export function createExecutionSupervisor() {
  let worker: Worker | undefined;
  let stopped = false;
  let restart: ReturnType<typeof setTimeout> | undefined;
  let recovering: Promise<void> = Promise.resolve();
  setBrowserChatExecutionOwner(sessionId => [...(worker?.tasks.values() || [])]
    .some(task => task.kind === 'chat' && task.id === sessionId));
  const forceStop = () => { if (worker) killTree(worker.child); };
  process.once('exit', forceStop);
  const recover = async (tasks: ExecutionTask[]) => {
    for (;;) {
      try { await recoverExecutionTasks(tasks); return; }
      catch (error) {
        console.error('[execution] Durable recovery failed; retrying before restart', error);
        if (stopped) throw error;
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  };
  const ensure = async () => {
    await recovering;
    if (stopped) throw new Error('Execution supervisor stopped');
    if (!worker) {
      const args = [
        '--max-old-space-size=' + (Number(process.env.ORBIT_EXECUTION_HEAP_MB) || 4096),
        process.env.WEBPILOT_BACKEND_LAUNCHER!, '--execution-worker',
        ...(process.env.WEBPILOT_BACKEND_DEV === 'true' ? ['--dev'] : []),
      ];
      const child = spawn(process.execPath, args, { cwd: process.env.WEBPILOT_APP_DIR, windowsHide: true,
        detached: process.platform !== 'win32', stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        env: { ...process.env, PORT: '0', WEBPILOT_SERVER_ROLE: 'execution' } });
      const current: Worker = { child, port: 0, ready: Promise.resolve(), tasks: new Map() };
      worker = current;
      current.ready = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error('Execution startup timed out')); killTree(child); }, 60_000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.on('message', (message: { type?: string; port?: number; task?: ExecutionTask; active?: boolean }) => {
          if (message?.type === 'ready' && message.port) { clearTimeout(timer); current.port = message.port; resolve(); }
          if (message?.type === 'execution-task' && message.task) {
            const key = `${message.task.kind}:${message.task.id}:${message.task.turnId || ''}`;
            if (message.active) current.tasks.set(key, message.task); else current.tasks.delete(key);
          }
        });
        child.once('exit', () => { clearTimeout(timer); reject(new Error('Execution process exited before ready')); });
      });
      // Observe rejection even while starting background services without HTTP traffic.
      void current.ready.catch(() => undefined);
      child.once('exit', () => {
        if (worker === current) worker = undefined;
        recovering = recover([...current.tasks.values()]);
        void recovering.catch(error => console.error('[execution] Durable recovery failed; restart blocked', error));
        if (!stopped) {
          restart = setTimeout(() => { void ensure().catch(error => console.error('[execution] Restart failed', error)); }, 500);
          restart.unref();
        }
      });
    }
    const current = worker;
    await current.ready;
    return current;
  };
  return {
    ensure,
    status: () => ({ pid: worker?.child.pid, ready: Boolean(worker?.port) }),
    async proxy(request: IncomingMessage, response: ServerResponse, pathname: string) {
      const current = await ensure();
      if (request.aborted || response.destroyed) return;
      let interruption: { body: Buffer; watchdog: boolean } | undefined;
      if (isInterruptRequest(request.method, pathname)) {
        try { interruption = await authorizeInterrupt(request, pathname, current.tasks.values()); }
        catch (error) {
          response.writeHead(413, { 'Content-Type': 'application/json', ...(pathname.startsWith('/api/embed/') ? { 'Access-Control-Allow-Origin': '*' } : {}) });
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Invalid interrupt request' }));
          return;
        }
      }
      if (request.aborted || response.destroyed) return;
      const upstream = http.request({ host: '127.0.0.1', port: current.port, method: request.method, path: request.url, headers: request.headers });
      let deadline: ReturnType<typeof setTimeout> | undefined;
      let forced = false;
      const clear = () => { if (deadline) clearTimeout(deadline); deadline = undefined; };
      if (interruption?.watchdog) deadline = setTimeout(() => {
        // Only the API process can act while the execution event loop is blocked.
        // Never replay a tool call after terminating an unresponsive worker.
        forced = true;
        killTree(current.child);
        upstream.destroy();
        if (!response.headersSent && !response.destroyed) {
          response.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '1', ...(pathname.startsWith('/api/embed/') ? { 'Access-Control-Allow-Origin': '*' } : {}) });
          response.end(JSON.stringify({ code: 'execution_restarted', error: '执行进程未响应中止，已请求强制终止，正在恢复任务状态。该进程中的任务不会自动重试，请稍后刷新会话。', interrupted: true }));
        }
      }, Math.max(500, Number(process.env.ORBIT_INTERRUPT_GRACE_MS) || 5000));
      upstream.once('response', incoming => {
        clear();
        response.writeHead(incoming.statusCode || 502, incoming.headers);
        incoming.once('error', error => response.destroy(error));
        incoming.pipe(response);
      });
      upstream.once('error', error => {
        clear();
        if (forced || response.destroyed) return;
        if (response.headersSent) { response.destroy(error); return; }
        response.writeHead(502, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ code: 'execution_unavailable', error: 'Execution process unavailable; the request was not replayed.' }));
      });
      request.once('aborted', () => { clear(); upstream.destroy(); });
      response.once('close', () => { clear(); if (!response.writableFinished) upstream.destroy(); });
      if (interruption) upstream.end(interruption.body); else request.pipe(upstream);
    },
    async close() {
      stopped = true;
      if (restart) clearTimeout(restart);
      const current = worker;
      if (!current || current.child.exitCode !== null) { await recovering; process.off('exit', forceStop); return; }
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => killTree(current.child), 5000);
        current.child.once('exit', () => { clearTimeout(timer); resolve(); });
        if (current.child.connected) current.child.send({ type: 'shutdown' }, () => undefined);
        else current.child.kill('SIGTERM');
      });
      await recovering;
      process.off('exit', forceStop);
    },
  };
}

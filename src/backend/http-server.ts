import { runtimeConfiguration, runtimeSetting } from '@/server/settings/runtime-configuration';
import http from 'node:http';
import { ERROR_CODES } from '@cjfclonedeep/capability-sdk';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { routes } from './route-manifest';
import { createRouter, sendWebResponse, webRequest } from './http-adapter';
import { createExecutionSupervisor, executionRequest } from './execution-supervisor';
import { startExecutionServices } from './bootstrap';
import { authorizeRequestCookie } from '@/server/auth/request-cookie-access';
import { receiveParentProcessMemory } from '@/server/observability/process-memory';

function authorized(value: unknown) {
  const expected = Buffer.from(process.env.WEBPILOT_INTERNAL_REQUEST_TOKEN || '');
  const supplied = Buffer.from(typeof value === 'string' ? value : '');
  return expected.length > 0 && supplied.length === expected.length && timingSafeEqual(expected, supplied);
}

type CodeSandboxLifecycle = {
  managedRunnerUrl(configuration: Readonly<Record<string, string | undefined>>): URL | undefined;
  sync(configuration: Readonly<Record<string, string | undefined>>): Promise<void>;
  close(): Promise<void>;
};

export async function startBackend({ codeSandbox }: { codeSandbox?: CodeSandboxLifecycle } = {}) {
  // Complete migrations before the execution child opens the same database.
  const { store } = await import('@/server/db/store');
  let refreshing: Promise<void> | undefined;
  const refreshRuntime = () => {
    if (refreshing) return refreshing;
    const operation = (async () => {
      await store.refreshRuntimeSettings();
      if (!codeSandbox) return;
      try {
        if (codeSandbox.managedRunnerUrl(runtimeConfiguration()) && !runtimeSetting('AGENT_CODE_SANDBOX_RUNNER_TOKEN')?.trim()) {
          await store.saveRuntimeSettings([{
            key: 'AGENT_CODE_SANDBOX_RUNNER_TOKEN', value: randomBytes(32).toString('base64url'), enabled: true, secret: true,
          }]);
          await store.refreshRuntimeSettings();
        }
      } catch (error) {
        // A misconfigured sandbox must not prevent opening Settings to repair it.
        console.error('[code-sandbox] Runner startup failed', error);
      }
    })();
    refreshing = operation.finally(() => { refreshing = undefined; });
    return refreshing;
  };
  await refreshRuntime();
  // Shared persistence is the source of truth for API and execution processes,
  // including background jobs that do not receive another HTTP request.
  const configurationTimer = setInterval(() => {
    void refreshRuntime().then(() => syncCodeSandbox()).catch(error => {
      console.error('[settings] Configuration refresh failed', error instanceof Error ? error.name : 'Error');
    });
  }, 1000);
  configurationTimer.unref();
  const syncCodeSandbox = () => codeSandbox?.sync(runtimeConfiguration()).catch(error => {
    console.error('[code-sandbox] Runner synchronization failed', error);
  });
  await syncCodeSandbox();
  const execution = process.env.WEBPILOT_SERVER_ROLE === 'execution';
  const parentMemory = (message: { type?: string; snapshot?: unknown }) => {
    if (message?.type === 'parent-process-memory') receiveParentProcessMemory(message.snapshot);
  };
  if (execution) process.on('message', parentMemory);
  const supervisor = execution ? undefined : createExecutionSupervisor();
  const route = createRouter(routes);
  const basePath = '/' + String(process.env.ORBIT_BASE_PATH ?? process.env.WEBPILOT_BASE_PATH ?? '').replace(/^\/+|\/+$/g, '');
  let stopServices: (() => Promise<void>) | undefined;
  let closing = false;
  let starting: Promise<void> | undefined;
  const server = http.createServer((incoming, outgoing) => {
    void (async () => {
      if (!authorized(incoming.headers['x-webpilot-backend-token'])) {
        outgoing.writeHead(401); outgoing.end(); return;
      }
      const url = new URL(incoming.url || '/', 'http://127.0.0.1');
      const pathname = basePath !== '/' && url.pathname.startsWith(`${basePath}/`) ? url.pathname.slice(basePath.length) : url.pathname;
      if (pathname === '/api/health') {
        await sendWebResponse(Response.json({ ok: !closing, role: execution ? 'execution' : 'api', pid: process.pid, execution: supervisor?.status() }), outgoing); return;
      }
      // Refresh the process-local configuration snapshot, never process.env.
      await refreshRuntime();
      // Runner health/recovery must not hold up unrelated page/API requests.
      // Its manager coalesces concurrent checks and monitors recovery itself.
      void syncCodeSandbox();
      const identityHeaders = new Headers();
      for (let i = 0; i < incoming.rawHeaders.length; i += 2) identityHeaders.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
      const identityDenied = await authorizeRequestCookie(new Request(url, { headers: identityHeaders, method: incoming.method }), pathname);
      if (identityDenied) { await sendWebResponse(identityDenied, outgoing); return; }
      if (supervisor && executionRequest(pathname, incoming.method)) {
        if (supervisor.configurationBarrierRequired(pathname, incoming.method)) await syncCodeSandbox();
        await supervisor.proxy(incoming, outgoing, pathname);
        return;
      }
      const request = webRequest(incoming, outgoing);
      const response = await route(request, pathname);
      if (pathname === '/api/settings/runtime' && incoming.method === 'POST' && response.ok) {
        await refreshing;
        await refreshRuntime();
        void syncCodeSandbox();
      }
      await sendWebResponse(response, outgoing, request.method === 'HEAD');
    })().catch(error => {
      if (outgoing.destroyed) return;
      console.error('[backend] Request failed', error);
      if (outgoing.headersSent) { outgoing.destroy(error); return; }
      outgoing.writeHead(500, { 'Content-Type': 'application/json' });
      outgoing.end(JSON.stringify({ code: ERROR_CODES.INTERNAL_ERROR, error: 'Internal Server Error' }));
    });
  });
  // SSE and downloads may remain open; bound only header/body ingress.
  server.requestTimeout = 300_000;
  server.headersTimeout = 60_000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(Number(process.env.PORT || 0), '127.0.0.1', resolve); });
  const port = (server.address() as import('node:net').AddressInfo).port;
  process.env.WEBPILOT_INTERNAL_ORIGIN = `http://127.0.0.1:${port}`;
  if (execution) {
    const start = async () => {
      if (closing) return;
      try {
        stopServices = await startExecutionServices();
      }
      catch (error) { console.error('[execution] Background startup failed', error); if (!closing) setTimeout(() => { starting = start(); }, 5000).unref(); }
    };
    starting = start();
  } else void supervisor!.ensure().catch(error => console.error('[backend] Execution startup failed', error));
  console.log(`[backend] ${execution ? 'Execution' : 'API'} ready on 127.0.0.1:${port}`);
  return { port, executionIdle: () => supervisor?.isIdle() ?? true, async close() {
    closing = true;
    clearInterval(configurationTimer);
    process.off('message', parentMemory);
    server.close();
    try {
      await supervisor?.close();
      await starting;
      await stopServices?.();
    } finally {
      await refreshing;
      await codeSandbox?.close();
      server.closeAllConnections();
    }
  } };
}

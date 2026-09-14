import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { routes } from './route-manifest';
import { createRouter, sendWebResponse, webRequest } from './http-adapter';
import { createExecutionSupervisor, executionRequest } from './execution-supervisor';
import { startExecutionServices } from './bootstrap';

function authorized(value: unknown) {
  const expected = Buffer.from(process.env.WEBPILOT_INTERNAL_REQUEST_TOKEN || '');
  const supplied = Buffer.from(typeof value === 'string' ? value : '');
  return expected.length > 0 && supplied.length === expected.length && timingSafeEqual(expected, supplied);
}

export async function startBackend() {
  // Complete migrations before the execution child opens the same database.
  const { store } = await import('@/server/db/store');
  await store.applyRuntimeEnv();
  const execution = process.env.WEBPILOT_SERVER_ROLE === 'execution';
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
      if (supervisor && executionRequest(pathname, incoming.method)) { await supervisor.proxy(incoming, outgoing, pathname); return; }
      const request = webRequest(incoming, outgoing);
      // Settings are persisted in the shared database; each process refreshes
      // its own environment before serving the next request.
      await store.applyRuntimeEnv();
      const response = await route(request, pathname);
      await sendWebResponse(response, outgoing, request.method === 'HEAD');
    })().catch(error => {
      if (outgoing.destroyed) return;
      console.error('[backend] Request failed', error);
      if (outgoing.headersSent) { outgoing.destroy(error); return; }
      outgoing.writeHead(500, { 'Content-Type': 'application/json' });
      outgoing.end(JSON.stringify({ error: 'Internal Server Error' }));
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
  return { port, async close() {
    closing = true;
    server.close();
    await supervisor?.close();
    await starting;
    await stopServices?.();
    server.closeAllConnections();
  } };
}

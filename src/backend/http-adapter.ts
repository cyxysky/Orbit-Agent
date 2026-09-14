import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';

export function webRequest(incoming: IncomingMessage, outgoing: ServerResponse) {
  const controller = new AbortController();
  const abort = () => controller.abort(new Error('HTTP client disconnected'));
  incoming.once('aborted', abort);
  outgoing.once('close', () => { if (!outgoing.writableFinished) abort(); });
  const headers = new Headers();
  for (let i = 0; i < incoming.rawHeaders.length; i += 2) headers.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
  const protocol = String(headers.get('x-forwarded-proto') || 'http').split(',')[0].trim();
  const host = headers.get('x-forwarded-host') || headers.get('host') || '127.0.0.1';
  const method = incoming.method || 'GET';
  return new Request(new URL(incoming.url || '/', `${protocol}://${host}`), {
    method, headers, signal: controller.signal,
    ...(!['GET', 'HEAD'].includes(method) ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}),
  } as RequestInit);
}

export async function sendWebResponse(response: Response, outgoing: ServerResponse, head = false) {
  outgoing.statusCode = response.status;
  outgoing.statusMessage = response.statusText;
  for (const [name, value] of response.headers) if (name !== 'set-cookie') outgoing.setHeader(name, value);
  const cookies = response.headers.getSetCookie();
  if (cookies.length) outgoing.setHeader('set-cookie', cookies);
  if (head || !response.body) { await response.body?.cancel(); outgoing.end(); return; }
  outgoing.flushHeaders();
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  outgoing.once('close', cancel);
  try {
    while (!outgoing.destroyed) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!outgoing.write(value)) {
        await new Promise<void>((resolve) => {
          const finish = () => { outgoing.off('drain', finish); outgoing.off('close', finish); resolve(); };
          outgoing.once('drain', finish); outgoing.once('close', finish);
        });
      }
    }
    if (!outgoing.destroyed) outgoing.end();
  } finally { outgoing.off('close', cancel); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

export type RouteModule = Record<string, unknown>;
export type RouteEntry = { path: string; load: () => Promise<RouteModule> };

export function createRouter(entries: RouteEntry[]) {
  const routes = entries.map(entry => {
    const keys: string[] = [];
    const segments = entry.path.split('/').map(segment => {
      if (segment.startsWith('[...')) { keys.push(segment.slice(4, -1)); return '(.+)'; }
      if (segment.startsWith('[')) { keys.push(segment.slice(1, -1)); return '([^/]+)'; }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
    return { ...entry, keys, regexp: new RegExp(`^${segments.join('/')}/?$`), weight: entry.path.split('/').reduce((n, s) => n + (s.startsWith('[...') ? 0 : s.startsWith('[') ? 1 : 10), 0) };
  }).sort((a, b) => b.weight - a.weight);
  return async (request: Request, pathname: string) => {
    for (const route of routes) {
      const match = route.regexp.exec(pathname);
      if (!match) continue;
      const params: Record<string, string | string[]> = {};
      try { route.keys.forEach((key, i) => { params[key] = route.path.includes(`[...${key}]`) ? match[i + 1].split('/').map(decodeURIComponent) : decodeURIComponent(match[i + 1]); }); }
      catch { return Response.json({ error: 'Invalid URL encoding' }, { status: 400 }); }
      const routeModule = await route.load();
      const method = request.method === 'HEAD' && !routeModule.HEAD ? 'GET' : request.method;
      const handler = routeModule[method];
      const allow = Object.keys(routeModule).filter(key => /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(key));
      if (routeModule.GET && !routeModule.HEAD) allow.push('HEAD');
      if (!routeModule.OPTIONS) allow.push('OPTIONS');
      if (request.method === 'OPTIONS' && !handler) return new Response(null, { status: 204, headers: { Allow: allow.join(', ') } });
      if (typeof handler !== 'function') return Response.json({ error: 'Method Not Allowed' }, { status: 405, headers: { Allow: allow.join(', ') } });
      const result = await handler(request, { params: Promise.resolve(params) });
      if (!(result instanceof Response)) throw new Error(`Route ${route.path} did not return a Response`);
      return result;
    }
    return Response.json({ error: 'Not Found' }, { status: 404 });
  };
}

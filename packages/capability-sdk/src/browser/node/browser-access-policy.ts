import type { Browser } from 'patchright';
import { WebSocket } from 'ws';
import { browserNavigationAllowed } from '../access-policy.ts';

type Policy = () => Readonly<Record<string, string | undefined>>;
const guards = new WeakMap<Browser, ReturnType<typeof connect>>();

/** Watch an owned target and its popups before their first response or Page event. */
export async function ensureBrowserRedirectPolicy(browser: Browser, endpoint: string, targetId: string, readPolicy: Policy) {
  let pending = guards.get(browser);
  if (!pending) {
    pending = connect(browser, endpoint).catch(error => { guards.delete(browser); throw error; });
    guards.set(browser, pending);
  }
  const guard = await pending;
  return guard.watch(targetId, readPolicy);
}

async function connect(browser: Browser, endpointValue: string) {
  let endpoint = endpointValue;
  if (/^https?:/iu.test(endpoint)) {
    const response = await fetch(`${endpoint.replace(/\/$/u, '')}/json/version`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Browser policy CDP discovery failed');
    endpoint = (await response.json() as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl;
  }
  const socket = new WebSocket(endpoint, { handshakeTimeout: 5000, perMessageDeflate: false });
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let sequence = 0;
  const policies = new Map<string, Policy>();
  const openers = new Map<string, string | undefined>();
  const setups = new Map<string, Promise<void>>();
  const commands = new Map<number, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const send = (method: string, params: object = {}, sessionId?: string) => new Promise<void>((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { commands.delete(id); reject(new Error(`Browser policy command timed out: ${method}`)); }, 5000);
    timer.unref(); commands.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }), error => {
      if (error) { clearTimeout(timer); commands.delete(id); reject(error); }
    });
  });
  const policyFor = (targetId: string) => {
    const visited = new Set<string>();
    let current: string | undefined = targetId;
    while (current && !visited.has(current)) {
      visited.add(current);
      const read = policies.get(current);
      if (read) return read();
      current = openers.get(current);
    }
    return process.env;
  };
  const targets = new Map<string, string>();
  socket.on('message', data => {
    const message = JSON.parse(String(data));
    if (message.id !== undefined) {
      const command = commands.get(message.id);
      if (!command) return;
      clearTimeout(command.timer); commands.delete(message.id);
      if (message.error) command.reject(new Error(message.error.message)); else command.resolve();
      return;
    }
    if (message.method === 'Target.attachedToTarget') {
      const { sessionId, targetInfo } = message.params;
      targets.set(sessionId, targetInfo.targetId); openers.set(targetInfo.targetId, targetInfo.openerId);
      const initialize = (async () => {
        try { await send('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Response' }] }, sessionId); }
        finally { await send('Runtime.runIfWaitingForDebugger', {}, sessionId); }
      })();
      setups.set(targetInfo.targetId, initialize);
      void initialize.catch(() => undefined);
    } else if (message.method === 'Fetch.requestPaused') {
      const request = message.params;
      const location = request.responseHeaders?.find((header: { name: string }) => header.name.toLowerCase() === 'location')?.value;
      let blocked = false;
      try {
        blocked = Boolean(location && request.responseStatusCode >= 300 && request.responseStatusCode < 400
          && !browserNavigationAllowed(new URL(location, request.request.url).href, policyFor(targets.get(message.sessionId) || '')));
      } catch { blocked = true; }
      void send(blocked ? 'Fetch.failRequest' : 'Fetch.continueResponse', blocked
        ? { requestId: request.requestId, errorReason: 'BlockedByClient' }
        : { requestId: request.requestId }, message.sessionId).catch(() => undefined);
    } else if (message.method === 'Target.detachedFromTarget') {
      const id = targets.get(message.params.sessionId);
      targets.delete(message.params.sessionId);
      if (id) { policies.delete(id); openers.delete(id); setups.delete(id); }
    }
  });
  const disconnect = () => socket.close();
  browser.once('disconnected', disconnect);
  socket.once('close', () => {
    browser.off('disconnected', disconnect); guards.delete(browser);
    for (const command of commands.values()) { clearTimeout(command.timer); command.reject(new Error('Browser policy connection closed')); }
    commands.clear(); policies.clear(); openers.clear(); targets.clear(); setups.clear();
  });
  // Only network interception is installed. Do not initialize/evaluate every
  // renderer or wait for unrelated pages, which may belong to another session.
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: 'page' }, { exclude: true }] });
  return { async watch(targetId: string, readPolicy: Policy) {
    policies.set(targetId, readPolicy);
    await setups.get(targetId);
    return () => { policies.delete(targetId); };
  } };
}

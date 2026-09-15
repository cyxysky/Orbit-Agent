/**
 * A session-local CDP endpoint. Playwright's browser-wide auto-attach waits for
 * every renderer, including hung pages owned by other conversations. Discover
 * metadata without attaching, then attach only host-owned pages and their popups.
 * This function is serialized into the code kernel; keep its closure self-contained.
 */
export async function createBrowserCodeCdpScope(input: {
  endpoint: string;
  targetIds: string[];
  timeoutMs: number;
  websocketModule: typeof import('ws');
}) {
  const { WebSocket, WebSocketServer } = input.websocketModule;
  const allowed = new Set(input.targetIds);
  if (!allowed.size) throw new Error('browserCode CDP scope requires an owned page.');
  let endpoint = input.endpoint;
  if (/^https?:/i.test(endpoint)) {
    const response = await fetch(`${endpoint.replace(/\/$/, '')}/json/version`, {
      signal: AbortSignal.timeout(input.timeoutMs),
    });
    if (!response.ok) throw new Error(`CDP endpoint discovery failed: HTTP ${response.status}.`);
    endpoint = String((await response.json() as { webSocketDebuggerUrl?: string }).webSocketDebuggerUrl || '');
  }
  const upstream = new WebSocket(endpoint, { handshakeTimeout: input.timeoutMs });
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0, perMessageDeflate: false });
  const route = `/${crypto.randomUUID()}`;
  let client: import('ws').WebSocket | undefined;
  let closed = false;
  let watching = false;
  let commandId = 0;
  type Payload = {
    targetId?: string;
    sessionId?: string;
    openerId?: string;
    type?: string;
    targetInfo?: Payload;
    targetInfos?: Payload[];
    [key: string]: unknown;
  };
  type Message = { id?: number; method?: string; sessionId?: string; params?: Payload; result?: Payload; error?: { message: string; code?: number } };
  const pending = new Map<number, { resolve: (value: Payload) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const sessions = new Map<string, string>();
  const attaching = new Map<string, Promise<void>>();
  const creating = new Set<number>();
  const close = () => {
    if (closed) return;
    closed = true;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('browserCode scoped CDP connection closed.'));
    }
    pending.clear();
    client?.terminate();
    upstream.terminate();
    server.close();
  };
  const send = (socket: import('ws').WebSocket | undefined, message: Message) => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 16 * 1024 * 1024) { close(); return; }
    socket.send(JSON.stringify(message));
  };
  const request = (method: string, params: Payload) => new Promise<Payload>((resolve, reject) => {
    if (closed) { reject(new Error('browserCode scoped CDP connection closed.')); return; }
    const id = --commandId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Scoped CDP ${method} timed out after ${input.timeoutMs}ms.`));
    }, input.timeoutMs);
    pending.set(id, { resolve, reject, timer });
    send(upstream, { id, method, params });
  });
  const attach = (targetId: string): Promise<void> => {
    if (sessions.has(targetId)) return Promise.resolve();
    const existing = attaching.get(targetId);
    if (existing) return existing;
    const task = request('Target.attachToTarget', { targetId, flatten: true }).then(() => undefined)
      .finally(() => attaching.delete(targetId));
    attaching.set(targetId, task);
    return task;
  };
  const updateTargets = async (targetIds: string[]) => {
    const next = new Set(targetIds);
    for (const targetId of allowed) {
      if (next.has(targetId)) continue;
      allowed.delete(targetId);
      const sessionId = sessions.get(targetId);
      if (sessionId) await request('Target.detachFromTarget', { sessionId });
    }
    for (const targetId of next) allowed.add(targetId);
    if (watching) await Promise.all([...next].map(attach));
  };
  const onUpstream = async (message: Message) => {
    if (message.id !== undefined && message.id < 0) {
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.reject(new Error(message.error.message));
      else item.resolve(message.result || {});
      return;
    }
    if (!message.sessionId) {
      const info = message.params?.targetInfo;
      if (message.method === 'Target.targetCreated' && info?.type === 'page' && info.targetId
        && allowed.has(String(info.openerId))) {
        allowed.add(info.targetId);
        if (watching) await attach(info.targetId);
      }
      if (message.method === 'Target.attachedToTarget') {
        if (!info?.targetId || !allowed.has(info.targetId) || !message.params?.sessionId) return;
        sessions.set(info.targetId, message.params.sessionId);
      }
      if (message.method === 'Target.detachedFromTarget') {
        const targetId = String(message.params?.targetId || '');
        sessions.delete(targetId);
      }
      if (info && !allowed.has(String(info.targetId))) return;
      if (message.method === 'Target.targetDestroyed') {
        const targetId = String(message.params?.targetId || '');
        if (!allowed.delete(targetId)) return;
        sessions.delete(targetId);
      }
      if (message.id !== undefined && creating.delete(message.id) && message.result?.targetId) {
        const targetId = String(message.result.targetId);
        allowed.add(targetId);
        await attach(targetId);
      }
      if (Array.isArray(message.result?.targetInfos)) {
        message.result!.targetInfos = message.result!.targetInfos!.filter((target) => allowed.has(String(target.targetId)));
      }
    }
    send(client, message);
  };
  upstream.on('message', (data) => {
    try { void onUpstream(JSON.parse(data.toString())).catch(close); } catch { close(); }
  });
  upstream.on('error', close);
  upstream.on('close', close);
  server.on('error', close);
  server.on('connection', (socket, httpRequest) => {
    if (client || httpRequest.url !== route || closed) { socket.terminate(); return; }
    client = socket;
    socket.on('error', close);
    socket.on('close', close);
    socket.on('message', (data) => {
      const handle = async () => {
        const message = JSON.parse(data.toString()) as Message;
        if (!message.sessionId && message.method === 'Target.setAutoAttach') {
          // Frame/worker auto-attach is still forwarded on page sessions. At the
          // browser root, never pause or initialize unrelated renderers.
          if (!watching) {
            watching = true;
            await request('Target.setDiscoverTargets', { discover: true, filter: [{ type: 'page' }] });
            await Promise.all([...allowed].map(attach));
          }
          send(socket, { id: message.id, result: {} });
          return;
        }
        if (!message.sessionId && message.params?.targetId && !allowed.has(String(message.params.targetId))) {
          send(socket, { id: message.id, error: { code: -32000, message: 'Target is outside this browserCode session.' } });
          return;
        }
        if (!message.sessionId && message.method === 'Target.createTarget' && message.id !== undefined) creating.add(message.id);
        send(upstream, message);
      };
      void handle().catch(close);
    });
  });
  try {
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        upstream.once('open', resolve);
        upstream.once('error', reject);
        upstream.once('close', () => reject(new Error('Scoped CDP upstream closed during startup.')));
      }),
      new Promise<void>((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
      }),
    ]);
    if (closed) throw new Error('Scoped CDP connection closed during startup.');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Scoped CDP listener has no port.');
    return { endpoint: `ws://127.0.0.1:${address.port}${route}`, targetIds: () => [...allowed], updateTargets, close };
  } catch (error) {
    close();
    throw error;
  }
}

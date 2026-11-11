'use client';

import { withWebPilotBasePath } from '@/lib/webpilot-base-path';
import { readApiJson } from '@/lib/api-client';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';


export type RealtimeRefreshEvent = {
  type: 'refresh';
  entityType: string;
  id: string;
  updatedAt: string;
  version: number;
  deleted?: boolean;
  patch?: unknown;
};

type RealtimeMessage = RealtimeRefreshEvent | {
  type: 'heartbeat' | 'hello';
  [key: string]: unknown;
} | {
  type: 'refresh-batch';
  events: RealtimeRefreshEvent[];
};

type RefreshListener = (event: RealtimeRefreshEvent) => void;

type RefreshSubscription = {
  listener: RefreshListener;
  onResync?: () => void | Promise<void>;
};

const subscriptions = new Set<RefreshSubscription>();

let socket: WebSocket | undefined;
let reconnectTimer: number | undefined;
let connectionTimer: number | undefined;
let idleTimer: number | undefined;
let ticketRequest: AbortController | undefined;
let reconnectDelay = 800;
let handshakeCompleted = false;
let socketReady = false;
let resyncRequired = false;

function online() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function notifyResyncRequired() {
  for (const subscription of [...subscriptions]) {
    if (!subscription.onResync) continue;
    void Promise.resolve().then(() => subscriptions.has(subscription) ? subscription.onResync?.() : undefined).catch(() => undefined);
  }
}

function scheduleReconnect() {
  if (reconnectTimer !== undefined || !subscriptions.size || !online()) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined;
    void connectRefreshWebSocket();
  }, Math.round(reconnectDelay * (0.8 + Math.random() * 0.4)));
  reconnectDelay = Math.min(30_000, Math.round(reconnectDelay * 1.6));
}

function clearConnectionTimer() {
  if (connectionTimer !== undefined) window.clearTimeout(connectionTimer);
  connectionTimer = undefined;
}

function watchConnection(nextSocket: WebSocket, timeout: number) {
  clearConnectionTimer();
  connectionTimer = window.setTimeout(() => {
    connectionTimer = undefined;
    if (socket === nextSocket) nextSocket.close();
  }, timeout);
}

async function refreshWebSocketUrl(signal: AbortSignal) {
  const endpoint = withWebPilotBasePath('/api/realtime/ws');
  const response = await fetch(endpoint, { cache: 'no-store', method: 'POST', signal });
  const data = await readApiJson<{ url: string }>(response, 'Realtime WebSocket is unavailable');
  if (typeof data.url !== 'string') throw new CodedError(ERROR_CODES.APPLICATION_ERROR, 'Realtime WebSocket is unavailable');
  return data.url;
}

async function connectRefreshWebSocket() {
  if (ticketRequest || reconnectTimer !== undefined || socket) return;
  if (!subscriptions.size || !online()) return;
  const request = new AbortController();
  ticketRequest = request;
  const requestTimeout = window.setTimeout(() => request.abort(), 10_000);
  try {
    const url = await refreshWebSocketUrl(request.signal);
    if (!subscriptions.size || request.signal.aborted || ticketRequest !== request) return;
    const nextSocket = new WebSocket(url);
    let helloReceived = false;
    socket = nextSocket;
    // A TCP upgrade alone is not a usable subscription; require the hub's hello.
    watchConnection(nextSocket, 10_000);
    nextSocket.onmessage = (message) => {
      if (socket !== nextSocket) return;
      let payload: RealtimeMessage | undefined;
      try {
        payload = JSON.parse(String(message.data)) as RealtimeMessage;
      } catch {
        return;
      }
      if (payload?.type === 'hello') {
        if (helloReceived) return;
        helloReceived = true;
        socketReady = true;
        reconnectDelay = 800;
        watchConnection(nextSocket, 75_000);
        const shouldResync = resyncRequired;
        handshakeCompleted = true;
        resyncRequired = false;
        if (shouldResync) notifyResyncRequired();
        return;
      }
      if (!helloReceived) return;
      if (payload?.type === 'heartbeat' || payload?.type === 'refresh' || payload?.type === 'refresh-batch') {
        watchConnection(nextSocket, 75_000);
      }
      const refreshEvents = payload?.type === 'refresh-batch' && Array.isArray(payload.events)
        ? payload.events
        : payload?.type === 'refresh'
          ? [payload]
          : [];
      if (refreshEvents.length && !subscriptions.size) resyncRequired = true;
      for (const event of refreshEvents) {
        if (event?.type !== 'refresh') continue;
        for (const subscription of [...subscriptions]) subscription.listener(event);
      }
    };
    nextSocket.onclose = () => {
      if (socket !== nextSocket) return;
      clearConnectionTimer();
      socket = undefined;
      socketReady = false;
      if (subscriptions.size) resyncRequired = true;
      scheduleReconnect();
    };
    nextSocket.onerror = () => {
      nextSocket.close();
    };
  } catch {
    if (ticketRequest === request) {
      resyncRequired = true;
      scheduleReconnect();
    }
  } finally {
    window.clearTimeout(requestTimeout);
    if (ticketRequest === request) ticketRequest = undefined;
  }
}

function disconnect() {
  if (reconnectTimer !== undefined) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
  const request = ticketRequest;
  ticketRequest = undefined;
  request?.abort();
  clearConnectionTimer();
  const previousSocket = socket;
  socket = undefined;
  socketReady = false;
  if (previousSocket) {
    previousSocket.onmessage = null;
    previousSocket.onclose = null;
    previousSocket.onerror = null;
    previousSocket.close();
  }
  if (subscriptions.size || handshakeCompleted) resyncRequired = true;
}

function reconnectWhenOnline() {
  reconnectDelay = 800;
  if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  void connectRefreshWebSocket();
}

function closeIfIdle() {
  if (subscriptions.size || idleTimer !== undefined) return;
  // Route hand-offs and React effect remounts can briefly have no listeners.
  // Keep the shared connection through that gap instead of cancelling an upgrade.
  idleTimer = window.setTimeout(() => {
    idleTimer = undefined;
    if (subscriptions.size) return;
    window.removeEventListener('online', reconnectWhenOnline);
    window.removeEventListener('offline', disconnect);
    disconnect();
  }, 250);
}

export function subscribeRealtimeRefresh(
  listener: RefreshListener,
  options: { onResync?: () => void | Promise<void> } = {},
) {
  const subscription: RefreshSubscription = { listener, onResync: options.onResync };
  if (idleTimer !== undefined) window.clearTimeout(idleTimer);
  idleTimer = undefined;
  subscriptions.add(subscription);
  window.addEventListener('online', reconnectWhenOnline);
  window.addEventListener('offline', disconnect);
  if (socketReady && resyncRequired) {
    resyncRequired = false;
    notifyResyncRequired();
  }
  void connectRefreshWebSocket();
  return () => {
    subscriptions.delete(subscription);
    closeIfIdle();
  };
}

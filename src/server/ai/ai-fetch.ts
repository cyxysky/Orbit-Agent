import { EnvHttpProxyAgent, type Dispatcher } from 'undici';
import { aiRequestTimeoutMs, aiRuntimeRequestTimeoutMs } from './ai-sdk-runtime';

export const AI_CONNECT_TIMEOUT_MS = 30_000;

const transportState = globalThis as typeof globalThis & {
  __webPilotAiDispatcher?: EnvHttpProxyAgent;
  __webPilotAiTimedDispatcher?: Dispatcher;
};

// Reuse the connection pool across requests and development module reloads.
// Keep this dispatcher local to AI requests rather than changing global fetch.
function aiDispatcher() {
  const pool = transportState.__webPilotAiDispatcher ??= new EnvHttpProxyAgent({
    connectTimeout: AI_CONNECT_TIMEOUT_MS,
    // ProxyAgent creates separate connectors for the proxy and target TLS.
    proxyTls: { timeout: AI_CONNECT_TIMEOUT_MS },
    requestTls: { timeout: AI_CONNECT_TIMEOUT_MS },
  });
  return transportState.__webPilotAiTimedDispatcher ??= pool.compose(dispatch => (options, handler) => {
    // Fetch/Undici otherwise impose an independent five-minute parser timeout.
    // Read current settings per request; shorter SDK deadlines and caller aborts
    // still apply, including while waiting for headers.
    const timeoutMs = Math.max(aiRequestTimeoutMs(), aiRuntimeRequestTimeoutMs());
    return dispatch({ ...options, headersTimeout: timeoutMs, bodyTimeout: timeoutMs }, handler);
  });
}

export const aiFetch: typeof globalThis.fetch = (input, init) => {
  const options: RequestInit & { dispatcher: Dispatcher } = {
    ...init,
    dispatcher: aiDispatcher(),
  };
  // Preserve the caller's abort signal and streaming response handling.
  return globalThis.fetch(input, options);
};

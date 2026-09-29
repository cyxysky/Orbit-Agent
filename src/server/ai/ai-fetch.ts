import { EnvHttpProxyAgent } from 'undici';

export const AI_CONNECT_TIMEOUT_MS = 30_000;

const transportState = globalThis as typeof globalThis & {
  __webPilotAiDispatcher?: EnvHttpProxyAgent;
};

// Reuse the connection pool across requests and development module reloads.
// Keep this dispatcher local to AI requests rather than changing global fetch.
function aiDispatcher() {
  return transportState.__webPilotAiDispatcher ??= new EnvHttpProxyAgent({
    connectTimeout: AI_CONNECT_TIMEOUT_MS,
    // ProxyAgent creates separate connectors for the proxy and target TLS.
    proxyTls: { timeout: AI_CONNECT_TIMEOUT_MS },
    requestTls: { timeout: AI_CONNECT_TIMEOUT_MS },
  });
}

export const aiFetch: typeof globalThis.fetch = (input, init) => {
  const options: RequestInit & { dispatcher: EnvHttpProxyAgent } = {
    ...init,
    dispatcher: aiDispatcher(),
  };
  // Preserve the caller's abort signal and streaming response handling.
  return globalThis.fetch(input, options);
};

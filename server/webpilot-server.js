/* eslint-disable @typescript-eslint/no-require-imports */
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { randomBytes } = require('node:crypto');
const {
  identityCookie,
  clearAuthenticationCookie,
  mountTicketClaims,
  requestIdentity,
} = require('./webpilot-identity');
const { createRealtimeRefreshHub } = require('./realtime-refresh-hub');
const { applyOrbitEnvironment, apiStartupTimeoutMs } = require('./orbit-environment');
const { stopProcessTree } = require('./process-tree.cjs');
const { browserChatStreamPath, createBrowserChatStreamHub } = require('./browser-chat-stream');
const { validateUpgradeCookieIdentity } = require('./user-cookie-access');
const { ADMIN_USER_ID, ADMIN_SESSION_COOKIE_NAME, assertAdministratorConfiguration, safeReturnPath } = require('./authentication-policy.cjs');
const { administratorSessionKey, readAdministratorPrincipal, revokeAdministratorSession, createAuthenticatedConnections } = require('./admin-session-client.cjs');

function normalizeBasePath(value) {
  const normalized = String(value || '').trim().replace(/^\/+|\/+$/g, '');
  return normalized ? `/${normalized}` : '';
}

function loadCompiledNextConfig(appDir) {
  const manifestPath = path.join(appDir, '.next', 'required-server-files.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`The compiled Next configuration is missing: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest || typeof manifest !== 'object' || !manifest.config || typeof manifest.config !== 'object') {
    throw new Error(`The compiled Next configuration is invalid: ${manifestPath}`);
  }
  return manifest.config;
}

function requireRuntimeDependency(appDir, dependency) {
  const runtimeRequire = createRequire(path.join(appDir, 'package.json'));
  try {
    return runtimeRequire(dependency);
  } catch (error) {
    const expectedPath = path.join(appDir, 'node_modules', dependency);
    throw new Error(
      `The packaged server dependency "${dependency}" could not be resolved from ${appDir}. Expected: ${expectedPath}.`,
      { cause: error },
    );
  }
}

function configureCompiledNextRuntime(compiledConfig, environment = process.env) {
  if (!compiledConfig) return;
  // Next reads this complete build-time configuration while initializing its
  // runtime. `conf` alone is insufficient in some packaged deployments: the
  // server can otherwise fall back to default routing despite route manifests
  // compiled with a basePath.
  environment.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(compiledConfig);
}

function configureNextDevelopmentRuntime(dev, environment = process.env) {
  if (!dev) return;
  // Next's route modules read this flag when they are constructed. Set it
  // before spawning the API runtime or loading Next so development routes do
  // not attempt to read production-only manifests.
  environment.__NEXT_DEV_SERVER = '1';
}

function applicationBasePath(dev, compiledConfig, environment = process.env) {
  // Next.js emits basePath into the route and client manifests at build time.
  // Production request and WebSocket routing must use that same value rather
  // than a possibly edited runtime .env file.
  return normalizeBasePath(dev ? (environment.ORBIT_BASE_PATH ?? environment.WEBPILOT_BASE_PATH) : compiledConfig?.basePath);
}

function stripBasePath(pathname, basePath) {
  if (!basePath) return pathname;
  if (pathname === basePath) return '/';
  return pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : pathname;
}

function publicPath(pathname) {
  return pathname === '/login'
    || ['/api/auth/login', '/api/auth/session', '/api/auth/logout'].includes(pathname)
    || pathname === '/favicon.ico'
    || pathname === '/icon.png'
    || pathname === '/apple-icon.png'
    || pathname === '/robots.txt'
    || pathname.startsWith('/_next/')
    || pathname.startsWith('/assets/')
    || pathname === '/api/embed/browser-chat/init'
    || pathname === '/embed/webpilot.js'
    || pathname === '/embed/orbit.js';
}

function removeUntrustedProxyHeaders(request) {
  if (String(process.env.WEBPILOT_TRUST_PROXY || '').trim().toLowerCase() === 'true') return;
  delete request.headers['forwarded'];
  delete request.headers['x-forwarded-for'];
  delete request.headers['x-forwarded-host'];
  delete request.headers['x-forwarded-port'];
  delete request.headers['x-forwarded-proto'];
}

function publicRequestOrigin(request) {
  const forwardedHost = String(request.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const forwardedProto = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const host = forwardedHost || String(request.headers.host || '').trim();
  const protocol = forwardedProto || (request.socket && request.socket.encrypted ? 'https' : 'http');
  return host ? `${protocol}://${host}` : '';
}

function normalizedOrigin(value) {
  try {
    return new URL(String(value || '')).origin;
  } catch {
    return '';
  }
}

function unsafeCrossOriginRequest(request) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(request.method || '').toUpperCase())) return false;
  const fetchSite = String(request.headers['sec-fetch-site'] || '').trim().toLowerCase();
  // Fetch Metadata is calculated by the browser from the public page and
  // request origins. It remains accurate when a reverse proxy rewrites the
  // upstream Host or protocol, unlike reconstructing the public origin from
  // the Node-facing request alone.
  if (fetchSite === 'same-origin') return false;
  const origin = String(request.headers.origin || '').trim();
  if (origin) return !normalizedOrigin(origin) || normalizedOrigin(origin) !== normalizedOrigin(publicRequestOrigin(request));
  return fetchSite === 'cross-site';
}

function rejectCrossOrigin(response) {
  const body = Buffer.from(JSON.stringify({ error: 'Cross-origin state change rejected' }), 'utf8');
  response.writeHead(403, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
  });
  response.end(body);
}

function internalPort(value, fallback) {
  const parsed = Number(value || fallback);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 65_535 ? Math.floor(parsed) : fallback;
}

const identityHeaderNames = new Set([
  'x-webpilot-client-address',
  'x-webpilot-identity-user-id',
  'x-webpilot-identity-username',
  'x-webpilot-identity-roles',
  'x-webpilot-identity-proof',
  'x-webpilot-identity-source',
]);

function applyTrustedIdentityHeaders(request, principal, proof) {
  const forwardedAddress = String(request.headers['x-real-ip'] || '').trim();
  const clientAddress = String(process.env.WEBPILOT_TRUST_PROXY || '').toLowerCase() === 'true' && net.isIP(forwardedAddress)
    ? forwardedAddress : request.socket?.remoteAddress || '';
  for (const name of identityHeaderNames) delete request.headers[name];
  if (Array.isArray(request.rawHeaders)) {
    const retained = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const name = String(request.rawHeaders[index] || '');
      if (identityHeaderNames.has(name.toLowerCase())) continue;
      retained.push(name, request.rawHeaders[index + 1]);
    }
    request.rawHeaders.splice(0, request.rawHeaders.length, ...retained);
  }
  request.headers['x-webpilot-client-address'] = clientAddress;
  request.rawHeaders?.push('x-webpilot-client-address', clientAddress);
  if (!principal) return;
  const userId = String(principal.userId || '').trim();
  const username = String(principal.username || '').trim();
  const roles = Array.isArray(principal.roles) ? principal.roles.map((role) => String(role || '').trim()).filter(Boolean) : [];
  const trustedProof = typeof proof === 'string' ? proof.trim() : '';
  if (!userId || !trustedProof) return;
  const values = {
    'x-webpilot-identity-user-id': userId,
    'x-webpilot-identity-username': username,
    'x-webpilot-identity-roles': roles.join(','),
    'x-webpilot-identity-proof': trustedProof,
    'x-webpilot-identity-source': principal.source,
  };
  for (const [name, value] of Object.entries(values)) {
    request.headers[name] = value;
    if (Array.isArray(request.rawHeaders)) request.rawHeaders.push(name, value);
  }
}

function proxyRequestHeaders(requestHeaders, target) {
  const headers = {};
  for (const [name, value] of Object.entries(requestHeaders || {})) {
    if (value !== undefined) headers[name] = value;
  }
  headers.host = requestHeaders?.host || `${target.hostname}:${target.port}`;
  return headers;
}

function runtimeApiRequest(pathname) {
  return pathname.startsWith('/api/') || pathname === '/embed/orbit.js' || pathname === '/embed/webpilot.js';
}

function splitRuntimeEnabled(dev, runtimeChildMode, environment = process.env) {
  return !runtimeChildMode;
}

function availableInternalPort(hostname) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, hostname, () => {
      const address = probe.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function waitForInternalPort(port, hostname, child, timeoutMs = 60_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    let timer;
    let completed = false;
    const finish = (error) => {
      if (completed) return;
      completed = true;
      if (timer) clearTimeout(timer);
      child.off('exit', onExit);
      if (error) reject(error);
      else resolve();
    };
    const onExit = (code, signal) => finish(new Error(
      `The API runtime exited before it became ready (code=${code ?? 'none'}, signal=${signal || 'none'}).`,
    ));
    const probe = () => {
      if (completed) return;
      const socket = net.createConnection({ host: hostname, port });
      let retried = false;
      socket.setTimeout(500);
      socket.once('connect', () => {
        socket.destroy();
        finish();
      });
      const retry = () => {
        if (retried || completed) return;
        retried = true;
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) {
          finish(new Error(`Timed out waiting for the API runtime on ${hostname}:${port}.`));
          return;
        }
        timer = setTimeout(probe, 100);
        timer.unref?.();
      };
      socket.once('error', retry);
      socket.once('timeout', retry);
    };
    child.once('exit', onExit);
    probe();
  });
}

async function startApiRuntimeChild({ appDir, dev, externalPort, runtimePort }) {
  const hostname = '127.0.0.1';
  const configuredPort = Number(runtimePort || process.env.WEBPILOT_RUNTIME_PORT || 0);
  const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65_535
    ? configuredPort
    : await availableInternalPort(hostname);
  const args = ['--max-old-space-size=' + (Number(process.env.ORBIT_API_HEAP_MB) || 1024), path.join(__dirname, 'start-backend.js'), ...(dev ? ['--dev'] : [])];
  const child = spawn(process.execPath, args, {
    cwd: appDir,
    env: {
      ...process.env,
      HOSTNAME: hostname,
      PORT: String(port),
      WEBPILOT_REALTIME_PUBLISH_PORT: String(externalPort),
      WEBPILOT_SERVER_ROLE: 'api',
      WEBPILOT_APP_DIR: appDir,
    },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    windowsHide: true,
  });
  child.once('error', (error) => {
    console.error('[webpilot-server] API runtime child failed.', error);
  });
  const stopChildOnExit = () => {
    stopProcessTree(child, { force: true });
  };
  process.once('exit', stopChildOnExit);
  child.once('exit', () => process.off('exit', stopChildOnExit));
  return { child, hostname, port, ready: waitForInternalPort(port, hostname, child, apiStartupTimeoutMs()) };
}

function createApiRuntimeSupervisor({
  appDir,
  dev,
  externalPort,
  startRuntime = startApiRuntimeChild,
  restartDelayMs = 250,
}) {
  let current;
  let runtimePort;
  let starting;
  let restartTimer;
  let stopped = false;

  const clearRestartTimer = () => {
    if (!restartTimer) return;
    clearTimeout(restartTimer);
    restartTimer = undefined;
  };

  const scheduleRestart = () => {
    if (stopped || restartTimer) return;
    restartTimer = setTimeout(() => {
      restartTimer = undefined;
      void ensure().catch((error) => {
        console.error('[webpilot-server] API runtime restart failed; retrying.', error);
        scheduleRestart();
      });
    }, restartDelayMs);
    restartTimer.unref?.();
  };

  const start = async () => {
    const runtime = await startRuntime({ appDir, dev, externalPort, runtimePort });
    if (stopped) {
      if (!runtime.child.killed) runtime.child.kill('SIGTERM');
      throw new Error('API runtime supervisor is stopped.');
    }
    current = runtime;
    // Next workers retain their initial environment. Keep their API URL valid
    // across child restarts instead of assigning a new ephemeral port each time.
    runtimePort = runtime.port;
    runtime.child.once('exit', (code, signal) => {
      if (current !== runtime) return;
      current = undefined;
      if (stopped) return;
      console.error(`[webpilot-server] API runtime exited (${code ?? 'unknown'}${signal ? `, ${signal}` : ''}); restarting.`);
      scheduleRestart();
    });
    try {
      await runtime.ready;
      if (current !== runtime) throw new Error('API runtime exited before it became available.');
      process.env.WEBPILOT_API_ORIGIN = `http://${runtime.hostname}:${runtime.port}`;
      const update = globalThis[Symbol.for('webpilot.updateInitialRuntimeEnv')];
      update?.({ WEBPILOT_API_ORIGIN: process.env.WEBPILOT_API_ORIGIN });
      return runtime;
    } catch (error) {
      if (current === runtime) current = undefined;
      if (!runtime.child.killed) runtime.child.kill('SIGTERM');
      scheduleRestart();
      throw error;
    }
  };

  const ensure = () => {
    if (stopped) return Promise.reject(new Error('API runtime supervisor is stopped.'));
    clearRestartTimer();
    if (current && current.child.exitCode == null && !current.child.killed) {
      const runtime = current;
      return Promise.resolve(runtime.ready).then(() => {
        if (current !== runtime) return ensure();
        return runtime;
      });
    }
    if (starting) return starting;
    starting = start().finally(() => {
      starting = undefined;
    });
    return starting;
  };

  const stop = () => {
    stopped = true;
    clearRestartTimer();
    const runtime = current;
    current = undefined;
    return runtime?.child ? stopProcessTree(runtime.child) : Promise.resolve();
  };

  return { ensure, stop };
}

function proxyHttpRequest(request, response, target, onResponse) {
  let clientDisconnected = false;
  const upstream = http.request({
    headers: { ...proxyRequestHeaders(request.headers, target), 'x-webpilot-backend-token': process.env.WEBPILOT_INTERNAL_REQUEST_TOKEN },
    hostname: target.hostname,
    method: request.method,
    path: request.url,
    port: target.port,
  }, (upstreamResponse) => {
    if (clientDisconnected) { upstreamResponse.destroy(); return; }
    onResponse?.(upstreamResponse.statusCode);
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.once('error', (error) => response.destroy(error));
    upstreamResponse.pipe(response);
  });
  upstream.once('error', (error) => {
    if (clientDisconnected || response.destroyed) return;
    console.error('[webpilot-server] API runtime proxy failed.', error);
    // A reset belongs to this request, not the lifetime of the API process.
    // The supervisor restarts the child only after its actual exit event.
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    response.writeHead(502, {
      'Content-Type': 'application/json; charset=utf-8',
      'Retry-After': '1',
    });
    response.end(JSON.stringify({ code: 'backend_unavailable', error: '服务连接已断开，请稍后重试。' }));
  });
  const disconnect = () => { clientDisconnected = true; upstream.destroy(); };
  request.once('aborted', disconnect);
  response.once('close', () => { if (!response.writableFinished) disconnect(); });
  request.pipe(upstream);
}

function webSocketUpgradeTarget(requestUrl, basePath) {
  const pathname = stripBasePath(requestUrl.pathname, basePath);
  const ticket = requestUrl.searchParams.get('ticket') || '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) return undefined;
  if (pathname === '/browser-preview') {
    return { kind: 'browser-preview', target: `/browser-preview${requestUrl.search}` };
  }
  if (pathname === '/refresh') {
    return { kind: 'refresh', target: `/refresh${requestUrl.search}` };
  }
  return undefined;
}

function nextDevelopmentUpgrade(requestUrl, basePath, dev) {
  if (!dev) return false;
  return requestUrl.pathname === `${normalizeBasePath(basePath)}/_next/hmr`;
}

function internalRequestAuthorized(request, pathname) {
  if (['GET', 'HEAD'].includes(request.method) && request.headers['x-webpilot-internal-purpose'] === 'render') {
    const expected = String(process.env.WEBPILOT_INTERNAL_REQUEST_TOKEN || '');
    return Boolean(expected) && request.headers['x-webpilot-internal-token'] === expected;
  }
  if (pathname === '/api/system/shutdown') {
    const expected = String(process.env.WEBPILOT_INTERNAL_SHUTDOWN_TOKEN || '');
    return Boolean(expected) && request.headers['x-webpilot-shutdown-token'] === expected;
  }
  if (pathname === '/api/automation/scheduler' || pathname === '/api/communication/runtime') {
    const expected = String(process.env.WEBPILOT_INTERNAL_REQUEST_TOKEN || '');
    return Boolean(expected) && request.headers['x-webpilot-internal-token'] === expected;
  }
  if (request.method === 'POST' && /^\/api\/automation\/runs\/[^/]+$/.test(pathname)) {
    const expected = String(process.env.WEBPILOT_INTERNAL_REQUEST_TOKEN || '');
    return Boolean(expected)
      && request.headers['x-webpilot-internal-token'] === expected
      && request.headers['x-webpilot-automation-scheduler'] === '1';
  }
  return false;
}

function internalPrincipal(request, pathname) {
  if (!internalRequestAuthorized(request, pathname)) return undefined;
  const userId = String(request.headers['x-webpilot-internal-user-id'] || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(userId)) return undefined;
  return { userId, username: 'internal-service', roles: ['user'], source: 'internal' };
}

function rejectMissingIdentity(response, requestUrl, basePath = '') {
  const loginUrl = basePath + '/login' + (requestUrl ? '?next=' + encodeURIComponent(requestUrl.pathname + requestUrl.search) : '');
  if (requestUrl && !stripBasePath(requestUrl.pathname, basePath).startsWith('/api/')) {
    response.writeHead(303, { 'Cache-Control': 'no-store', Location: loginUrl }); response.end(); return;
  }
  const body = Buffer.from(JSON.stringify({ code: 'authentication_required', error: '请先登录。', loginUrl }), 'utf8');
  response.writeHead(401, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
  });
  response.end(body);
}

async function initializeMountedIdentity(request, response, requestUrl, beforeSwitch) {
  const ticket = requestUrl.searchParams.get('identityTicket') || '';
  if (!ticket) return false;
  const claims = mountTicketClaims(ticket);
  if (!claims || claims.userId === ADMIN_USER_ID) {
    rejectMissingIdentity(response);
    return true;
  }
  const refererOrigin = normalizedOrigin(request.headers.referer);
  if (claims.origin && refererOrigin && normalizedOrigin(claims.origin) !== refererOrigin) {
    rejectMissingIdentity(response);
    return true;
  }
  await beforeSwitch?.();
  requestUrl.searchParams.delete('identityTicket');
  response.writeHead(303, {
    'Cache-Control': 'no-store',
    'Location': `${requestUrl.pathname}${requestUrl.search}`,
    'Set-Cookie': [identityCookie(claims.userId, request), clearAuthenticationCookie(ADMIN_SESSION_COOKIE_NAME, request)],
  });
  response.end();
  return true;
}

function proxyUpgrade(request, clientSocket, head, port, targetPath) {
  const upstream = net.connect({ host: '127.0.0.1', port }, () => {
    const headers = Object.entries(request.headers)
      .filter(([name, value]) => value !== undefined && name.toLowerCase() !== 'host')
      .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}`)
      .join('\r\n');
    upstream.write(`${request.method || 'GET'} ${targetPath} HTTP/${request.httpVersion}\r\nHost: 127.0.0.1:${port}\r\n${headers}\r\n\r\n`);
    if (head && head.length) upstream.write(head);
    clientSocket.pipe(upstream).pipe(clientSocket);
  });
  const close = () => {
    clientSocket.destroy();
    upstream.destroy();
  };
  upstream.once('error', close);
  clientSocket.once('error', close);
}

async function main() {
  applyOrbitEnvironment();
  const dev = process.argv.includes('--dev');
  const runtimeChildMode = false;
  configureNextDevelopmentRuntime(dev);
  // Only a dedicated UI process may skip the background runtime loops.
  process.env.WEBPILOT_SERVER_ROLE = splitRuntimeEnabled(dev, runtimeChildMode) ? 'ui' : 'runtime';
  const hostname = String(process.env.HOSTNAME || '127.0.0.1');
  const port = Math.max(1, Math.floor(Number(process.env.PORT || 3000)));
  const appDir = path.resolve(process.env.WEBPILOT_APP_DIR || process.cwd());
  const { loadEnvConfig, updateInitialEnv } = requireRuntimeDependency(appDir, '@next/env');
  loadEnvConfig(appDir, dev);
  const orbitEnvironment = applyOrbitEnvironment();
  assertAdministratorConfiguration();
  updateInitialEnv(orbitEnvironment);
  // App modules may bundle another @next/env instance. Route all persisted
  // setting updates to the same snapshot used by this native Next server.
  globalThis[Symbol.for('webpilot.updateInitialRuntimeEnv')] = updateInitialEnv;
  process.env.WEBPILOT_REALTIME_PUBLISH_TOKEN ||= randomBytes(32).toString('base64url');
  process.env.WEBPILOT_IDENTITY_HEADER_SECRET ||= randomBytes(32).toString('base64url');
  process.env.WEBPILOT_IDENTITY_SECRET ||= randomBytes(32).toString('base64url');
  process.env.WEBPILOT_INTERNAL_REQUEST_TOKEN ||= randomBytes(32).toString('base64url');
  // Next reloads its initial environment when routes or .env files change.
  // Keep process-lifetime credentials in that snapshot, without persisting them.
  updateInitialEnv(Object.fromEntries([
    'WEBPILOT_REALTIME_PUBLISH_TOKEN', 'WEBPILOT_IDENTITY_HEADER_SECRET',
    'WEBPILOT_IDENTITY_SECRET', 'WEBPILOT_INTERNAL_REQUEST_TOKEN',
  ].map((key) => [key, process.env[key]])));
  const identityHeaderSecret = process.env.WEBPILOT_IDENTITY_HEADER_SECRET;
  const compiledConfig = dev ? undefined : loadCompiledNextConfig(appDir);
  const resolvedBasePath = applicationBasePath(dev, compiledConfig);
  process.env.ORBIT_BASE_PATH = resolvedBasePath;
  process.env.WEBPILOT_BASE_PATH = resolvedBasePath;
  updateInitialEnv({ ORBIT_BASE_PATH: resolvedBasePath, WEBPILOT_BASE_PATH: resolvedBasePath });
  const apiRuntimeSupervisor = createApiRuntimeSupervisor({ appDir, dev, externalPort: port });
  process.env.WEBPILOT_SERVER_ROLE = apiRuntimeSupervisor ? 'ui' : 'runtime';
  updateInitialEnv({ WEBPILOT_SERVER_ROLE: process.env.WEBPILOT_SERVER_ROLE });

  // Load the complete build-time configuration before loading Next itself.
  // This applies to the packaged runtime regardless of whether the build uses
  // output: 'standalone'.
  configureCompiledNextRuntime(compiledConfig);
  // Electron starts this file with its bundled Node runtime. Resolve Next from
  // the external server directory explicitly instead of relying on Electron's
  // process-level NODE_PATH initialization.
  const next = requireRuntimeDependency(appDir, 'next');

  const developmentWebpack = dev && process.argv.includes('--webpack');
  if (dev) {
    console.info(`[webpilot-server] Development compiler: ${developmentWebpack ? 'Webpack' : 'Turbopack'}`);
  }
  const application = next({
    dev,
    dir: appDir,
    hostname,
    port,
    // Use Turbopack for development. Webpack is an explicit diagnostic option,
    // never an automatic response to a slow route or a refresh problem.
    turbopack: dev && !developmentWebpack,
    webpack: developmentWebpack,
    ...(compiledConfig ? { conf: compiledConfig } : {}),
  });
  const handle = application.getRequestHandler();
  // Page rendering reads initialization data from the independent Node API.
  await apiRuntimeSupervisor?.ensure();
  await application.prepare();
  const handleNextUpgrade = dev ? application.getUpgradeHandler() : undefined;

  // In production the build manifest is the sole source of truth for basePath.
  const basePath = applicationBasePath(dev, compiledConfig);

  const refreshHub = createRealtimeRefreshHub({ appDir });
  const connections = createAuthenticatedConnections();
  const authenticate = async request => administratorSessionKey(request)
    ? await readAdministratorPrincipal(request, await apiRuntimeSupervisor.ensure()) : requestIdentity(request);
  const chatStreamHub = createBrowserChatStreamHub({
    getRuntime: () => apiRuntimeSupervisor.ensure(),
    authenticateRequest: request => {
      return request.headers['x-webpilot-identity-proof'] === identityHeaderSecret && Boolean(request.headers['x-webpilot-identity-user-id']);
    },
  });
  const server = http.createServer((request, response) => {
    void (async () => {
      removeUntrustedProxyHeaders(request);
      const requestUrl = new URL(request.url || '/', `http://${request.headers.host || `${hostname}:${port}`}`);
      const pathname = stripBasePath(requestUrl.pathname, basePath);

      if (requestUrl.pathname === '/_webpilot/realtime/publish') {
        await refreshHub.handlePublish(request, response);
        return;
      }

      if (
        unsafeCrossOriginRequest(request)
        && pathname !== '/api/embed/browser-chat/init'
        && !internalRequestAuthorized(request, pathname)
      ) {
        rejectCrossOrigin(response);
        return;
      }

      if (request.method === 'GET' && pathname === '/browser-chat' && await initializeMountedIdentity(request, response, requestUrl, async () => {
        if (!administratorSessionKey(request)) return;
        await revokeAdministratorSession(request, await apiRuntimeSupervisor.ensure());
        connections.revoke(request);
      })) return;

      const principal = internalPrincipal(request, pathname) || (!publicPath(pathname) || pathname === '/login' ? await authenticate(request) : undefined);
      applyTrustedIdentityHeaders(request, principal, identityHeaderSecret);

      if (pathname === '/login' && principal?.source === 'admin' && ['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(303, { 'Cache-Control': 'no-store', Location: safeReturnPath(requestUrl.searchParams.get('next'), basePath) }); response.end(); return;
      }
      if (pathname === '/api/auth/logout' && request.method === 'POST') connections.revoke(request);

      if (!principal && !publicPath(pathname) && !internalRequestAuthorized(request, pathname)) {
        rejectMissingIdentity(response, requestUrl, basePath);
        return;
      }
      if (principal?.source === 'admin' && pathname !== '/api/auth/logout') connections.track(request, response, principal);
      if (apiRuntimeSupervisor && runtimeApiRequest(pathname)) {
        try {
          const apiRuntime = await apiRuntimeSupervisor.ensure();
          proxyHttpRequest(request, response, apiRuntime, status => {
            if (pathname === '/api/auth/login' && status >= 200 && status < 300) connections.revoke(request);
          });
        } catch (error) {
          console.error('[webpilot-server] API runtime is unavailable.', error);
          if (!response.headersSent) {
            response.writeHead(503, {
              'Content-Type': 'application/json; charset=utf-8',
              'Retry-After': '1',
            });
          }
          response.end(JSON.stringify({ code: 'backend_unavailable', error: '服务正在恢复，请稍后重试。' }));
        }
        return;
      }
      await handle(request, response);
    })().catch((error) => {
      console.error('[webpilot-server] HTTP request failed.', error);
      if (error.code === 'authentication_service_unavailable' && !response.headersSent) {
        response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '1' });
        response.end(JSON.stringify({ code: error.code, error: '身份验证服务暂时不可用，请稍后重试。' }));
        return;
      }
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Internal Server Error');
    });
  });

  server.on('upgrade', (request, socket, head) => {
    void (async () => {
    removeUntrustedProxyHeaders(request);
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || `${hostname}:${port}`}`);
    if (browserChatStreamPath(stripBasePath(requestUrl.pathname, basePath)) || webSocketUpgradeTarget(requestUrl, basePath)) {
      const principal = await authenticate(request);
      applyTrustedIdentityHeaders(request, principal, identityHeaderSecret);
      if (!principal || !await validateUpgradeCookieIdentity(request, await apiRuntimeSupervisor.ensure(), requestUrl.searchParams.get('ticket'))) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return;
      }
      connections.track(request, socket, principal);
    }
    if (browserChatStreamPath(stripBasePath(requestUrl.pathname, basePath))) {
      chatStreamHub.acceptUpgrade(request, socket, head);
      return;
    }
    const target = webSocketUpgradeTarget(requestUrl, basePath);
    if (!target) {
      if (handleNextUpgrade && nextDevelopmentUpgrade(requestUrl, basePath, dev)) {
        void Promise.resolve(handleNextUpgrade(request, socket, head)).catch((error) => {
          console.error('[webpilot-server] Next.js development WebSocket upgrade failed.', error);
          socket.destroy();
        });
        return;
      }
      socket.destroy();
      return;
    }
    if (target.kind === 'browser-preview') {
      proxyUpgrade(request, socket, head, internalPort(process.env.BROWSER_CHAT_PREVIEW_WS_PORT, 18021), target.target);
      return;
    }
    await refreshHub.acceptUpgrade(request, socket, requestUrl);
    })().catch(() => socket.destroy());
  });

  server.listen(port, hostname, () => {
    const role = runtimeChildMode ? 'API runtime' : apiRuntimeSupervisor ? 'UI' : 'UI + API runtime';
    console.log(`[webpilot-server] ${role} ready on http://${hostname}:${port}${basePath || '/'}`);
  });

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    refreshHub.close();
    chatStreamHub.close();
    server.close();
    await apiRuntimeSupervisor.stop();
    server.closeAllConnections();
    await application.close();
    process.exit(0);
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  process.on('message', message => { if (message?.type === 'shutdown') void close(); });
  if (process.connected) process.once('disconnect', () => void close());
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[webpilot-server] Failed to start.', error);
    process.exitCode = 1;
  });
}

module.exports = {
  apiStartupTimeoutMs,
  applyTrustedIdentityHeaders,
  applicationBasePath,
  initializeMountedIdentity,
  internalPrincipal,
  createApiRuntimeSupervisor,
  configureCompiledNextRuntime,
  configureNextDevelopmentRuntime,
  loadCompiledNextConfig,
  nextDevelopmentUpgrade,
  normalizeBasePath,
  proxyRequestHeaders,
  requireRuntimeDependency,
  runtimeApiRequest,
  splitRuntimeEnabled,
  stripBasePath,
  unsafeCrossOriginRequest,
  webSocketUpgradeTarget,
};

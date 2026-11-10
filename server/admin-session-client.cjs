/* eslint-disable @typescript-eslint/no-require-imports */
const http = require('node:http');
const { createHash } = require('node:crypto');
const { ADMIN_SESSION_COOKIE_NAME, readCookie } = require('./authentication-policy.cjs');
const principalRequests = new WeakMap();

class AuthenticationServiceError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'AuthenticationServiceError';
    this.code = 'authentication_service_unavailable';
    this.statusCode = 503;
  }
}

function administratorSessionKey(request) {
  const token = readCookie(request.headers.cookie, ADMIN_SESSION_COOKIE_NAME);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? createHash('sha256').update(token).digest('hex') : '';
}
function authenticationRequest(request, runtime, path, method = 'GET') {
  return new Promise((resolve, reject) => {
    let deadline;
    const fail = cause => { clearTimeout(deadline); reject(cause instanceof AuthenticationServiceError ? cause : new AuthenticationServiceError('Authentication service unavailable', cause)); };
    const check = http.request({ hostname: runtime.hostname, port: runtime.port, path, method,
      headers: { cookie: request.headers.cookie || '', ...(process.env.WEBPILOT_INTERNAL_REQUEST_TOKEN ? { 'x-webpilot-backend-token': process.env.WEBPILOT_INTERNAL_REQUEST_TOKEN } : {}) } }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; if (body.length > 8192) check.destroy(new Error('Invalid authentication response')); });
      response.once('error', fail);
      response.once('aborted', () => check.destroy(new AuthenticationServiceError('Authentication response interrupted')));
      response.once('end', () => {
        clearTimeout(deadline);
        try {
          if (response.statusCode !== 200) throw new AuthenticationServiceError('Authentication service unavailable');
          const data = JSON.parse(body);
          resolve(data);
        } catch (error) { fail(error); }
      });
    });
    deadline = setTimeout(() => check.destroy(new AuthenticationServiceError('Authentication service timeout')), 5000);
    deadline.unref();
    check.once('error', fail);
    check.end();
  });
}
async function readAdministratorPrincipal(request, runtime) {
  const key = administratorSessionKey(request);
  if (!key) return undefined;
  let pending = principalRequests.get(runtime);
  if (!pending) { pending = new Map(); principalRequests.set(runtime, pending); }
  if (!pending.has(key)) {
    const operation = authenticationRequest(request, runtime, '/api/auth/session').then(data => {
      if (typeof data?.authenticated !== 'boolean') throw new AuthenticationServiceError('Invalid authentication response');
      return data.authenticated && data.principal?.source === 'admin' && data.principal.expiresAt > Date.now() ? data.principal : undefined;
    }).finally(() => { if (pending.get(key) === operation) pending.delete(key); });
    pending.set(key, operation);
  }
  // Coalesce only in-flight checks. Revocations remain visible on the next request.
  return pending.get(key);
}
async function revokeAdministratorSession(request, runtime) {
  principalRequests.get(runtime)?.delete(administratorSessionKey(request));
  await authenticationRequest(request, runtime, '/api/auth/logout', 'POST');
}
function createAuthenticatedConnections() {
  const sessions = new Map();
  function close(key) {
    const session = sessions.get(key);
    if (!session) return;
    clearTimeout(session.timer); sessions.delete(key);
    for (const connection of session.connections) connection.destroy();
  }
  return {
    track(request, connection, principal) {
      if (principal.source !== 'admin') return;
      const key = administratorSessionKey(request);
      if (!key) return;
      let session = sessions.get(key);
      if (!session) {
        session = { connections: new Set(), timer: setTimeout(() => close(key), Math.max(0, principal.expiresAt - Date.now())) };
        session.timer.unref(); sessions.set(key, session);
      }
      session.connections.add(connection);
      connection.once('close', () => {
        session.connections.delete(connection);
        if (!session.connections.size && sessions.get(key) === session) { clearTimeout(session.timer); sessions.delete(key); }
      });
    },
    revoke(request) { close(administratorSessionKey(request)); },
  };
}
module.exports = { administratorSessionKey, readAdministratorPrincipal, revokeAdministratorSession, createAuthenticatedConnections };

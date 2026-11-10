const http = require('node:http');
const { createHash } = require('node:crypto');
const { ADMIN_SESSION_COOKIE_NAME, readCookie } = require('./authentication-policy.cjs');

function administratorSessionKey(request) {
  const token = readCookie(request.headers.cookie, ADMIN_SESSION_COOKIE_NAME);
  return token ? createHash('sha256').update(token).digest('hex') : '';
}
function authenticationRequest(request, runtime, path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const check = http.request({ hostname: runtime.hostname, port: runtime.port, path, method,
      headers: { cookie: request.headers.cookie || '', 'x-webpilot-backend-token': process.env.WEBPILOT_INTERNAL_REQUEST_TOKEN } }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; if (body.length > 8192) check.destroy(new Error('Invalid authentication response')); });
      response.once('error', reject);
      response.once('end', () => {
        try {
          if (response.statusCode !== 200) throw new Error('Authentication service unavailable');
          const data = JSON.parse(body);
          resolve(data);
        } catch (error) { reject(error); }
      });
    });
    check.setTimeout(5000, () => check.destroy(new Error('Authentication service timeout')));
    check.once('error', reject);
    check.end();
  });
}
async function readAdministratorPrincipal(request, runtime) {
  const data = await authenticationRequest(request, runtime, '/api/auth/session');
  return data.authenticated && data.principal?.source === 'admin' ? data.principal : undefined;
}
async function revokeAdministratorSession(request, runtime) {
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

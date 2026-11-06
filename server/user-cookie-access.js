/* eslint-disable @typescript-eslint/no-require-imports */
const http = require('node:http');

function userCookieCheckEnabled() {
  return String(process.env.ORBIT_USER_COOKIE_CHECK_ENABLED ?? process.env.WEBPILOT_USER_COOKIE_CHECK_ENABLED ?? '').trim().toLowerCase() === 'true';
}

// The API owns the binding database. Upgrades validate before consuming a one-use ticket.
function validateUpgradeCookieIdentity(request, runtime, ticket) {
  return new Promise(resolve => {
    const query = ticket ? '?webSocketTicket=' + encodeURIComponent(ticket) : '';
    const headers = { ...request.headers, 'x-webpilot-backend-token': process.env.WEBPILOT_INTERNAL_REQUEST_TOKEN };
    delete headers.connection; delete headers.upgrade;
    const check = http.get({ hostname: runtime.hostname, port: runtime.port, path: '/api/workspace/context' + query, headers }, response => {
      response.resume(); response.once('end', () => resolve(response.statusCode === 200));
      response.once('error', () => resolve(false));
    });
    check.setTimeout(5000, () => check.destroy());
    check.once('error', () => resolve(false));
  });
}
module.exports = { userCookieCheckEnabled, validateUpgradeCookieIdentity };

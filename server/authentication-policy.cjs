const { createHash, timingSafeEqual } = require('node:crypto');

const ADMIN_USER_ID = '1';
const ADMIN_SESSION_COOKIE_NAME = 'orbit_admin_session';
const MOUNT_IDENTITY_COOKIE_NAME = 'webpilot_identity';
const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function administratorLoginEnabled(environment = process.env) {
  return String(environment.ORBIT_ADMIN_SETTINGS_PASSWORD_ENABLED ?? environment.WEBPILOT_ADMIN_SETTINGS_PASSWORD_ENABLED ?? '').trim().toLowerCase() === 'true';
}
function administratorPassword(environment = process.env) {
  return String(environment.ORBIT_ADMIN_SETTINGS_PASSWORD ?? environment.WEBPILOT_ADMIN_SETTINGS_PASSWORD ?? '');
}
function verifyAdministratorPassword(value, environment = process.env) {
  if (!administratorLoginEnabled(environment) || !administratorPassword(environment) || typeof value !== 'string') return false;
  const digest = text => createHash('sha256').update(text, 'utf8').digest();
  return timingSafeEqual(digest(value), digest(administratorPassword(environment)));
}
function assertAdministratorConfiguration(environment = process.env) {
  if (administratorLoginEnabled(environment) && !administratorPassword(environment)) {
    throw new Error('ORBIT_ADMIN_SETTINGS_PASSWORD must be configured when administrator login is enabled.');
  }
}
function readCookie(header, name) {
  for (const item of String(header || '').split(';')) {
    const split = item.indexOf('=');
    if (split < 1 || item.slice(0, split).trim() !== name) continue;
    try { return decodeURIComponent(item.slice(split + 1).trim()); } catch { return ''; }
  }
  return '';
}
function safeReturnPath(value, basePath = '') {
  const base = '/' + String(basePath).replace(/^\/+|\/+$/g, '');
  const prefix = base === '/' ? '' : base;
  const fallback = prefix + '/browser-chat';
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return fallback;
  try {
    const url = new URL(value, 'https://orbit.invalid');
    if (url.origin !== 'https://orbit.invalid' || prefix && !url.pathname.startsWith(prefix + '/')) return fallback;
    const pathname = prefix ? url.pathname.slice(prefix.length) : url.pathname;
    if (pathname === '/login' || pathname.startsWith('/api/') || pathname.startsWith('/_next/')) return fallback;
    return url.pathname + url.search + url.hash;
  } catch { return fallback; }
}

module.exports = { ADMIN_USER_ID, ADMIN_SESSION_COOKIE_NAME, MOUNT_IDENTITY_COOKIE_NAME, ADMIN_SESSION_TTL_MS,
  administratorLoginEnabled, administratorPassword, verifyAdministratorPassword, assertAdministratorConfiguration, readCookie, safeReturnPath };

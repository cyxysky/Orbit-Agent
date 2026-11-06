import { createHmac, timingSafeEqual } from 'node:crypto';
import { credentialMasterKey, encryptCredentialSecret } from '@/server/credentials/credential-master-key';
import { normalizeBrowserCookieDomain, parseBrowserCookieHeader, saveBrowserDomainCookie } from '@/server/credentials/browser-domain-cookie-vault';
import { executeDatabase, queryDatabaseOne, runDatabaseTransaction } from '@/server/db/database';
import { ApiRequestError } from '@/server/http/api-request';
import { requestApplicationPrincipal } from './user-context';

const internalCookies = new Set(['webpilot_identity', 'WEBPILOTQA_LANGUAGE', 'webpilotqa_sidebar_collapsed']);
export function userCookieCheckEnabled() {
  return String(process.env.ORBIT_USER_COOKIE_CHECK_ENABLED ?? process.env.WEBPILOT_USER_COOKIE_CHECK_ENABLED ?? '').trim().toLowerCase() === 'true';
}
export function canonicalIdentityCookie(header: string, domain: string) {
  if (Buffer.byteLength(header, 'utf8') > 64 * 1024) throw new ApiRequestError('Cookie 请求头过大。', { status: 413 });
  const names = String(process.env.ORBIT_USER_COOKIE_NAMES ?? process.env.WEBPILOT_USER_COOKIE_NAMES ?? '').split(',').map(name => name.trim()).filter(Boolean);
  const cookies = parseBrowserCookieHeader(header, domain).filter(cookie => !internalCookies.has(cookie.name) && (!names.length || names.includes(cookie.name)));
  if (!cookies.length || names.some(name => !cookies.some(cookie => cookie.name === name))) throw new ApiRequestError('缺少用于身份校验的登录 Cookie。', { status: 401 });
  return cookies.sort((left, right) => left.name.localeCompare(right.name, 'en')).map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
}
function fingerprint(cookie: string, domain: string) {
  return createHmac('sha256', credentialMasterKey()).update(JSON.stringify(['user-cookie', domain, cookie])).digest('hex');
}
export async function bindUserIdentityCookie(request: Request, domainValue: string) {
  const principal = requestApplicationPrincipal(request);
  if (principal.source !== 'mounted') throw new ApiRequestError('请先通过可信挂载身份绑定 Cookie。', { status: 401 });
  const domain = normalizeBrowserCookieDomain(domainValue);
  const cookie = canonicalIdentityCookie(request.headers.get('cookie') || '', domain);
  const digest = fingerprint(cookie, domain), timestamp = new Date().toISOString();
  const encrypted = encryptCredentialSecret(cookie, Buffer.from(JSON.stringify(['user-cookie', principal.userId, domain])));
  return runDatabaseTransaction(async database => {
    const duplicate = await queryDatabaseOne<{ id: string }>('SELECT id FROM application_user WHERE cookie_domain = ? AND cookie_fingerprint = ? AND id <> ?', [domain, digest, principal.userId], database);
    if (duplicate) throw new ApiRequestError('此登录 Cookie 已绑定其他用户。', { status: 409 });
    await executeDatabase(`INSERT INTO application_user(id, cookie, cookie_domain, cookie_fingerprint, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET cookie=excluded.cookie,
      cookie_domain=excluded.cookie_domain, cookie_fingerprint=excluded.cookie_fingerprint, updated_at=excluded.updated_at`,
    [principal.userId, encrypted, domain, digest, timestamp, timestamp], database);
    // Tickets are short lived, but a replaced identity must invalidate outstanding ones immediately.
    await executeDatabase('DELETE FROM websocket_ticket WHERE user_id = ?', [principal.userId], database);
    const businessCookies = parseBrowserCookieHeader(request.headers.get('cookie') || '', domain)
      .filter(cookie => !internalCookies.has(cookie.name)).map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
    return saveBrowserDomainCookie(principal.userId, domain, businessCookies, database);
  });
}
export async function assertUserIdentityCookie(request: Request, userId: string) {
  if (!userCookieCheckEnabled()) return;
  const identity = await queryDatabaseOne<{ cookie_domain: string; cookie_fingerprint: string }>(
    'SELECT cookie_domain, cookie_fingerprint FROM application_user WHERE id = ?', [userId]);
  if (!identity?.cookie_domain || !identity.cookie_fingerprint) throw new ApiRequestError('此用户尚未绑定登录 Cookie。请先完成可信身份绑定。', { status: 401 });
  const cookie = canonicalIdentityCookie(request.headers.get('cookie') || '', identity.cookie_domain);
  const supplied = Buffer.from(fingerprint(cookie, identity.cookie_domain)), expected = Buffer.from(identity.cookie_fingerprint);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new ApiRequestError('登录 Cookie 与用户 ID 不一致，请通过可信挂载重新绑定。', { status: 401 });
}

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { credentialMasterKey } from '@/server/credentials/credential-master-key';
import { executeDatabase, queryDatabaseOne, runDatabaseTransaction } from '@/server/db/database';
import { ADMIN_USER_ID, ADMIN_SESSION_COOKIE_NAME, MOUNT_IDENTITY_COOKIE_NAME, ADMIN_SESSION_TTL_MS,
  administratorLoginEnabled, administratorPassword, readCookie } from '../../../server/authentication-policy.cjs';

export { ADMIN_SESSION_COOKIE_NAME };
const prefix = 'auth-session:admin:';
const sessionSchema = z.object({ version: z.literal(1), userId: z.literal(ADMIN_USER_ID),
  credentialRevision: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.number(), expiresAt: z.number() }).strict();
const requestSessions = new WeakMap<Request, ReturnType<typeof loadAdminSession>>();

function revision() { return createHmac('sha256', credentialMasterKey()).update('orbit-admin-session\0' + administratorPassword()).digest('hex'); }
function tokenOf(request: Request) {
  const value = readCookie(request.headers.get('cookie'), ADMIN_SESSION_COOKIE_NAME);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : '';
}
function sessionKey(token: string) { return prefix + createHash('sha256').update(token).digest('hex'); }
async function loadAdminSession(request: Request) {
  if (!administratorLoginEnabled() || !administratorPassword()) return undefined;
  const token = tokenOf(request);
  if (!token) return undefined;
  const key = sessionKey(token);
  const row = await queryDatabaseOne<{ value: string }>('SELECT value FROM runtime_meta WHERE key = ?', [key]);
  if (!row) return undefined;
  let parsed;
  try { parsed = sessionSchema.safeParse(JSON.parse(row.value)); } catch { return undefined; }
  if (!parsed.success || parsed.data.expiresAt <= Date.now()
    || !timingSafeEqual(Buffer.from(parsed.data.credentialRevision), Buffer.from(revision()))) {
    await executeDatabase('DELETE FROM runtime_meta WHERE key = ?', [key]);
    return undefined;
  }
  return { userId: parsed.data.userId, username: 'administrator', roles: ['admin'], source: 'admin' as const,
    expiresAt: parsed.data.expiresAt };
}
export function readAdminSession(request: Request) {
  let pending = requestSessions.get(request);
  if (!pending) { pending = loadAdminSession(request); requestSessions.set(request, pending); }
  return pending;
}
export async function createAdminSession(request: Request) {
  const token = randomBytes(32).toString('base64url'), now = Date.now();
  const session = { version: 1 as const, userId: ADMIN_USER_ID, createdAt: now,
    expiresAt: now + ADMIN_SESSION_TTL_MS, credentialRevision: revision() };
  await runDatabaseTransaction(async database => {
    await executeDatabase('DELETE FROM runtime_meta WHERE key LIKE ? AND updated_at < ?',
      [prefix + '%', new Date(now - ADMIN_SESSION_TTL_MS).toISOString()], database);
    const previous = tokenOf(request);
    if (previous) await executeDatabase('DELETE FROM runtime_meta WHERE key = ?', [sessionKey(previous)], database);
    await executeDatabase('INSERT INTO runtime_meta(key,value,updated_at) VALUES (?,?,?)',
      [sessionKey(token), JSON.stringify(session), new Date(now).toISOString()], database);
  });
  return { token, expiresAt: session.expiresAt };
}
export async function revokeAdminSession(request: Request) {
  const token = tokenOf(request);
  if (token) await executeDatabase('DELETE FROM runtime_meta WHERE key = ?', [sessionKey(token)]);
  requestSessions.delete(request);
}
function cookieAttributes(request: Request) {
  const base = String(process.env.ORBIT_BASE_PATH ?? process.env.WEBPILOT_BASE_PATH ?? '').replace(/^\/+|\/+$/g, '');
  const crossSite = String(process.env.ORBIT_CROSS_SITE_MOUNT ?? process.env.WEBPILOT_CROSS_SITE_MOUNT ?? '').toLowerCase() === 'true';
  const secure = crossSite || process.env.WEBPILOT_COOKIE_SECURE === 'true' || new URL(request.url).protocol === 'https:' || request.headers.get('x-forwarded-proto')?.split(',')[0].trim() === 'https';
  return `HttpOnly; Path=${base ? '/' + base : '/'}; SameSite=${crossSite ? 'None' : 'Lax'}${secure ? '; Secure' : ''}`;
}
export function adminSessionCookie(request: Request, token: string) {
  return `${ADMIN_SESSION_COOKIE_NAME}=${token}; Max-Age=${Math.floor(ADMIN_SESSION_TTL_MS / 1000)}; ${cookieAttributes(request)}`;
}
export function clearAuthenticationCookies(request: Request) {
  return [ADMIN_SESSION_COOKIE_NAME, MOUNT_IDENTITY_COOKIE_NAME].map(name => `${name}=; Max-Age=0; ${cookieAttributes(request)}`);
}
export function authenticationResponse(data: unknown, status = 200, headers?: HeadersInit) {
  const result = new Headers(headers);
  result.set('Cache-Control', 'no-store'); result.set('Pragma', 'no-cache'); result.set('Vary', 'Cookie');
  return Response.json(data, { status, headers: result });
}
export function rejectCrossOriginAuthentication(request: Request) {
  const origin = request.headers.get('origin');
  if (request.headers.get('sec-fetch-site') === 'cross-site' || origin && origin !== new URL(request.url).origin) {
    return authenticationResponse({ code: 'forbidden', error: '登录请求来源不匹配。' }, 403);
  }
}

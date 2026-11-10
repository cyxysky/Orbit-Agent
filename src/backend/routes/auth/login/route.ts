import { z } from 'zod';
import { parseJsonRequest } from '@/server/http/api-request';
import { createAdminSession, adminSessionCookie, clearAuthenticationCookies, authenticationResponse, rejectCrossOriginAuthentication } from '@/server/auth/admin-session';
import { loginAttemptKey, loginRetryAfter, recordLoginAttempt } from '@/server/auth/login-attempts';
import { administratorLoginEnabled, administratorPassword, verifyAdministratorPassword, safeReturnPath } from '../../../../../server/authentication-policy.cjs';

export async function POST(request: Request) {
  const denied = rejectCrossOriginAuthentication(request);
  if (denied) return denied;
  if (!administratorLoginEnabled() || !administratorPassword()) return authenticationResponse({ error: '管理员登录尚未配置，请联系部署管理员。' }, 503);
  const key = loginAttemptKey(request), retry = loginRetryAfter(key);
  if (retry) return authenticationResponse({ error: '尝试次数过多，请稍后重试。' }, 429, { 'Retry-After': String(retry) });
  let body;
  try { body = await parseJsonRequest(request, z.object({ password: z.string().min(1).max(4000), next: z.string().max(4096).optional() }).strict(), { maxBytes: 8 * 1024 }); }
  catch { return authenticationResponse({ error: '请输入管理员密码。' }, 400); }
  const verified = verifyAdministratorPassword(body.password);
  recordLoginAttempt(key, verified);
  if (!verified) return authenticationResponse({ error: '密码错误，请重试。' }, 401);
  const session = await createAdminSession(request);
  const response = authenticationResponse({ ok: true, expiresAt: session.expiresAt,
    redirectTo: safeReturnPath(body.next, process.env.ORBIT_BASE_PATH ?? process.env.WEBPILOT_BASE_PATH ?? '') });
  // Rotate credentials on login and remove the previous mounted Orbit identity.
  response.headers.append('Set-Cookie', clearAuthenticationCookies(request)[1]);
  response.headers.append('Set-Cookie', adminSessionCookie(request, session.token));
  return response;
}

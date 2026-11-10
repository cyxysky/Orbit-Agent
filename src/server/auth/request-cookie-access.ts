import { apiError, ApiRequestError } from '@/server/http/api-request';
import { readEmbedAuth } from '@/server/embed/browser-chat-embed';
import { requestApplicationPrincipal } from './user-context';
import { assertUserIdentityCookie } from './user-cookie-identity';
import { readAdminSession, authenticationResponse } from './admin-session';
import { ADMIN_USER_ID } from '../../../server/authentication-policy.cjs';

/** One identity boundary for API reads, mutations, files and execution proxies. */
export async function authorizeRequestCookie(request: Request, pathname: string) {
  if (request.method === 'OPTIONS') return;
  if (['/api/auth/login', '/api/auth/logout', '/api/auth/session', '/embed/orbit.js', '/embed/webpilot.js', '/api/embed/browser-chat/init'].includes(pathname)) return;
  try {
    const principal = requestApplicationPrincipal(request);
    if (principal.source === 'admin') {
      const session = await readAdminSession(request);
      if (!session || session.userId !== principal.userId) return authenticationResponse({ code: 'authentication_required', error: '登录已失效，请重新登录。' }, 401);
      return;
    }
    if (principal.source === 'internal') return;
    if (principal.userId === ADMIN_USER_ID) throw new ApiRequestError('管理员必须通过密码登录。', { status: 403 });
    // Initialization validates its submitted ID before reading any saved session.
    // Cookie replacement requires the existing signed mount identity instead of the old cookie.
    if (pathname === '/api/browser-cookies/domp') {
      if (requestApplicationPrincipal(request).source !== 'mounted') throw new ApiRequestError('请先通过可信挂载身份绑定 Cookie。', { status: 401 });
      return;
    }
    if (pathname.startsWith('/api/embed/')) {
      const embedded = readEmbedAuth(request);
      if (embedded.userId !== principal.userId) throw new ApiRequestError('挂载身份不匹配。', { status: 403 });
      await assertUserIdentityCookie(request, principal.userId);
      return;
    }
    await assertUserIdentityCookie(request, principal.userId);
  } catch (error) {
    if (!(error instanceof ApiRequestError)) return authenticationResponse({ code: 'authentication_required', error: '身份校验失败。' }, 401);
    return apiError(request, error, { fallback: '身份校验失败。' });
  }
}

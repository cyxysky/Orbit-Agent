import { apiError, ApiRequestError } from '@/server/http/api-request';
import { readEmbedAuth } from '@/server/embed/browser-chat-embed';
import { requestApplicationPrincipal } from './user-context';
import { assertUserIdentityCookie, userCookieCheckEnabled } from './user-cookie-identity';

/** One identity boundary for API reads, mutations, files and execution proxies. */
export async function authorizeRequestCookie(request: Request, pathname: string) {
  if (!userCookieCheckEnabled() || request.method === 'OPTIONS') return;
  if (['/embed/orbit.js', '/embed/webpilot.js', '/api/embed/browser-chat/init'].includes(pathname)) return;
  try {
    // Initialization validates its submitted ID before reading any saved session.
    // Cookie replacement requires the existing signed mount identity instead of the old cookie.
    if (pathname === '/api/browser-cookies/domp') {
      if (requestApplicationPrincipal(request).source !== 'mounted') throw new ApiRequestError('请先通过可信挂载身份绑定 Cookie。', { status: 401 });
      return;
    }
    if (pathname.startsWith('/api/embed/')) {
      await assertUserIdentityCookie(request, readEmbedAuth(request).userId);
      return;
    }
    const principal = requestApplicationPrincipal(request);
    if (principal.source === 'internal') return;
    await assertUserIdentityCookie(request, principal.userId);
  } catch (error) {
    return apiError(request, error instanceof ApiRequestError ? error : new ApiRequestError('身份校验失败。', { status: 401 }), { fallback: '身份校验失败。' });
  }
}

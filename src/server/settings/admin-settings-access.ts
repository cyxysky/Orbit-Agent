import { requestApplicationPrincipal } from '@/server/auth/user-context';
import { isAiOperationsAdmin } from '@/server/auth/ai-operations-admin';
import { ApiRequestError, apiError } from '@/server/http/api-request';

export function requestCanAccessSettings(request: Pick<Request, 'headers'>) {
  try {
    const principal = requestApplicationPrincipal(request);
    return isAiOperationsAdmin(principal.userId) && (principal.source === 'admin' || principal.source === 'internal');
  } catch { return false; }
}
export function requestHasAdminSettingsAccess(request: Request) { return requestCanAccessSettings(request); }
export function authorizeSettingsMenuRequest(request: Request) {
  if (!requestCanAccessSettings(request)) return apiError(request,
    new ApiRequestError('仅已登录的管理员可以访问设置。', { code: 'forbidden', status: 403 }), { fallback: '无法访问设置。' });
}
export const authorizeAdminSettingsRequest = authorizeSettingsMenuRequest;

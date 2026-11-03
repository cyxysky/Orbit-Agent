import { ApiRequestError } from '@/server/http/api-request';
import { requestApplicationPrincipal, type ApplicationPrincipal } from '@/server/auth/user-context';
import { ERROR_CODES } from '@cjfclonedeep/capability-sdk';


export const AI_OPERATIONS_ADMIN_USER_ID = '1';

export function isAiOperationsAdmin(userId: unknown) {
  return String(userId ?? '').trim() === AI_OPERATIONS_ADMIN_USER_ID;
}

export function requireAiOperationsAdmin(request: Pick<Request, 'headers'>): ApplicationPrincipal {
  const principal = requestApplicationPrincipal(request);
  if (!isAiOperationsAdmin(principal.userId)) {
    throw new ApiRequestError('AI operations administrator access is required', {
      code: ERROR_CODES.AI_OPERATIONS_ADMIN_REQUIRED,
      status: 403,
    });
  }
  return principal;
}

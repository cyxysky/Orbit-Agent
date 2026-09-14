import { requireAiOperationsAdmin } from '@/server/auth/ai-operations-admin';
import { apiError, apiJson } from '@/server/http/api-request';
import { readBackendRuntimeStatus } from '@/server/observability/backend-runtime-status';


export async function GET(request: Request) {
  try {
    requireAiOperationsAdmin(request);
    return apiJson(request, readBackendRuntimeStatus());
  } catch (error) {
    return apiError(request, error, { fallback: 'Unable to load backend runtime status', status: 500 });
  }
}

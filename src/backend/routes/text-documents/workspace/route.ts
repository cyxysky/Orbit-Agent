import { executeTextWorkspace, textWorkspaceInput } from '@/server/capabilities/text-workspace';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { apiError, apiJson, parseJsonRequest } from '@/server/http/api-request';
import { store } from '@/server/db/store';
export async function POST(request: Request) {
  try {
    const userId = requestApplicationUserId(request), input = await parseJsonRequest(request, textWorkspaceInput, { maxBytes: null });
    if (input.action === 'rewrite') await store.refreshRuntimeSettings();
    return apiJson(request, await executeTextWorkspace(input, userId, request.signal));
  } catch (error) { return apiError(request, error, { fallback: '文本操作失败，请稍后重试。' }); }
}

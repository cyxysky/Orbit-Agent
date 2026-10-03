import { executeNovelWorkspace, novelWorkspaceInput } from '@/server/capabilities/novel-workspace';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { apiError, apiJson, parseJsonRequest } from '@/server/http/api-request';
import { store } from '@/server/db/store';

export async function POST(request: Request) {
  try {
    const userId = requestApplicationUserId(request);
    const input = await parseJsonRequest(request, novelWorkspaceInput, { maxBytes: null });
    if (input.action === 'rewrite') await store.applyRuntimeEnv();
    return apiJson(request, await executeNovelWorkspace(input, userId, request.signal));
  } catch (error) {
    return apiError(request, error, { fallback: '小说操作失败，修改未覆盖原稿。请稍后重试。' });
  }
}

import { requestApplicationUserId } from '@/server/auth/user-context';
import { ApiRequestError, apiError, apiJson } from '@/server/http/api-request';
import type { BrowserChatSessionRouteContext } from '@/server/http/browser-chat-route';
import { readBrowserChatMessageFileGroups } from '@/server/storage/browser-chat-files';

export async function GET(request: Request, context: BrowserChatSessionRouteContext) {
  try {
    const { sessionId } = await context.params;
    const groups = await readBrowserChatMessageFileGroups(sessionId, requestApplicationUserId(request));
    if (!groups) throw new ApiRequestError('对话不存在。', { code: 'not_found', status: 404 });
    return apiJson(request, { groups });
  } catch (error) {
    return apiError(request, error, { fallback: '读取对话文件失败' });
  }
}

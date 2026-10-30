import { getBrowserChatSession } from '@/server/ai/agents/browser-chat.service';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { ApiRequestError, apiError, apiJson } from '@/server/http/api-request';
import type { BrowserChatSessionRouteContext } from '@/server/http/browser-chat-route';

/** A complete, owned snapshot, independent of the UI's virtualized history window. */
export async function GET(request: Request, context: BrowserChatSessionRouteContext) {
  try {
    const { sessionId } = await context.params;
    const session = await getBrowserChatSession(sessionId, requestApplicationUserId(request));
    if (!session) throw new ApiRequestError('对话不存在。', { code: 'not_found', status: 404 });
    const { id, title, messages, steps, subagents } = session;
    return apiJson(request, { id, title, messages, steps, subagents, exportedAt: new Date().toISOString() });
  } catch (error) {
    return apiError(request, error, { fallback: '读取完整对话失败' });
  }
}

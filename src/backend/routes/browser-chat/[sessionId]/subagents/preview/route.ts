import { selectBrowserChatSubagentPreview } from '@/server/ai/agents/browser-chat.service';
import { ApiRequestError, apiError, apiJson } from '@/server/http/api-request';
import { requestApplicationUserId } from '@/server/auth/user-context';
import type { BrowserChatSessionRouteContext } from '@/server/http/browser-chat-route';

export async function POST(request: Request, context: BrowserChatSessionRouteContext) {
  try {
    const { sessionId } = await context.params;
    const session = await selectBrowserChatSubagentPreview(sessionId, undefined, requestApplicationUserId(request));
    if (!session) throw new ApiRequestError('Browser chat session not found', { code: 'not_found', status: 404 });
    return apiJson(request, { session });
  } catch (error) {
    return apiError(request, error, { fallback: 'Failed to return to the parent browser' });
  }
}

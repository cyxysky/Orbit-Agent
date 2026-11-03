import { interruptBrowserChatSession } from '@/server/ai/agents/browser-chat.service';
import { ApiRequestError, apiError, apiJson } from '@/server/http/api-request';
import { requestApplicationUserId } from '@/server/auth/user-context';
import type { BrowserChatSessionRouteContext } from '@/server/http/browser-chat-route';
import { ERROR_CODES } from '@cjfclonedeep/capability-sdk';



export async function POST(request: Request, context: BrowserChatSessionRouteContext) {
  const { sessionId } = await context.params;
  try {
    const body = await request.json().catch(() => ({})) as { clientMessageId?: unknown };
    const clientMessageId = typeof body.clientMessageId === 'string' ? body.clientMessageId.trim() : '';
    if (!clientMessageId) {
      throw new ApiRequestError('Browser chat turn id is required', { code: ERROR_CODES.INVALID_REQUEST, status: 400 });
    }
    const session = await interruptBrowserChatSession(sessionId, clientMessageId, requestApplicationUserId(request));
    if (!session) throw new ApiRequestError('Browser chat session not found', { code: ERROR_CODES.NOT_FOUND, status: 404 });
    return apiJson(request, { session });
  } catch (error) {
    return apiError(request, error, { fallback: 'Browser chat interrupt failed', status: 500 });
  }
}

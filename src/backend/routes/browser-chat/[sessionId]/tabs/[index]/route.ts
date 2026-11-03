import { switchBrowserChatTab } from '@/server/ai/agents/browser-chat.service';
import { ApiRequestError, apiError, apiJson } from '@/server/http/api-request';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { ERROR_CODES } from '@cjfclonedeep/capability-sdk';



type RouteContext = {
  params: Promise<{ sessionId: string; index: string }>;
};

function requestUserId(request: Request) {
  return requestApplicationUserId(request);
}

export async function POST(request: Request, context: RouteContext) {
  const { sessionId, index } = await context.params;
  try {
    const session = await switchBrowserChatTab(sessionId, index, requestUserId(request));
    if (!session) throw new ApiRequestError('Browser chat session not found', { code: ERROR_CODES.NOT_FOUND, status: 404 });
    return apiJson(request, { session });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to switch browser tab';
    const status = /session not found/i.test(message) || /closed/i.test(message) ? 404 : /Invalid tab id/i.test(message) ? 400 : 500;
    return apiError(request, error instanceof ApiRequestError ? error : new ApiRequestError(message, {
      code: status === 404 ? ERROR_CODES.NOT_FOUND : status === 400 ? ERROR_CODES.INVALID_TAB_ID : ERROR_CODES.TAB_SWITCH_FAILED,
      status,
    }), { fallback: 'Failed to switch browser tab', status });
  }
}

import { deleteBrowserChatSessions } from '@/server/ai/agents/browser-chat.service';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { deleteBrowserChatSessionsRequestSchema } from '@/server/http/browser-chat-request.schema';
import { apiError, apiJson, parseJsonRequest } from '@/server/http/api-request';


function requestUserId(request: Request) {
  return requestApplicationUserId(request);
}

export async function POST(request: Request) {
  try {
    const body = await parseJsonRequest(request, deleteBrowserChatSessionsRequestSchema, { maxBytes: 64 * 1024 });
    const result = await deleteBrowserChatSessions(body.ids, requestUserId(request));
    return apiJson(request, { ok: true, ...result });
  } catch (error) {
    return apiError(request, error, { fallback: 'Failed to delete browser chat sessions' });
  }
}

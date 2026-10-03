import { selectBrowserChatSubagentPreview } from '@/server/ai/agents/browser-chat.service';
import { ApiRequestError, apiError, apiJson } from '@/server/http/api-request';
import { requestApplicationUserId } from '@/server/auth/user-context';

type RouteContext = { params: Promise<{ sessionId: string; subagentId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { sessionId, subagentId } = await context.params;
    const session = await selectBrowserChatSubagentPreview(sessionId, subagentId, requestApplicationUserId(request));
    if (!session) throw new ApiRequestError('Browser chat sub-agent not found', { code: 'not_found', status: 404 });
    return apiJson(request, { session });
  } catch (error) {
    return apiError(request, error, { fallback: 'Failed to open sub-agent verification page' });
  }
}

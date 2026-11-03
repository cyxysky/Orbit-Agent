import { z } from 'zod';
import { updateBrowserChatSessionTools } from '@/server/ai/agents/browser-chat.service';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { ApiRequestError, apiError, apiJson, parseJsonRequest } from '@/server/http/api-request';
import type { BrowserChatSessionRouteContext } from '@/server/http/browser-chat-route';
import { ERROR_CODES } from '@cjfclonedeep/capability-sdk';


export async function PATCH(request: Request, context: BrowserChatSessionRouteContext) {
  try {
    const { sessionId } = await context.params;
    const body = await parseJsonRequest(request, z.object({ disabledTools: z.array(z.string().max(80)).max(64) }).strict(), { maxBytes: 8192 });
    const disabledTools = await updateBrowserChatSessionTools(sessionId, body.disabledTools, requestApplicationUserId(request));
    if (!disabledTools) throw new ApiRequestError('会话不存在', { code: ERROR_CODES.NOT_FOUND, status: 404 });
    return apiJson(request, { disabledTools });
  } catch (error) { return apiError(request, error, { fallback: '无法保存工具设置' }); }
}

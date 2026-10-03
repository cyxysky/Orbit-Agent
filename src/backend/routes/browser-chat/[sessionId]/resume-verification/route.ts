import { resumeBrowserChatHumanVerification } from '@/server/ai/agents/browser-chat.service';
import { ApiRequestError, apiError, apiJson, parseOptionalJsonRequest } from '@/server/http/api-request';
import { requestApplicationUserId } from '@/server/auth/user-context';
import type { BrowserChatSessionRouteContext } from '@/server/http/browser-chat-route';
import { z } from 'zod';

const resumeVerificationSchema = z.object({ subagentId: z.string().trim().min(1).max(160).optional() });

export async function POST(request: Request, context: BrowserChatSessionRouteContext) {
  const { sessionId } = await context.params;
  try {
    const body = await parseOptionalJsonRequest(request, resumeVerificationSchema, { maxBytes: 1024 });
    return apiJson(request, { session: await resumeBrowserChatHumanVerification(sessionId, requestApplicationUserId(request), body.subagentId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to resume browser chat verification';
    return apiError(request, error instanceof ApiRequestError ? error : new ApiRequestError(message, {
      code: /not found/i.test(message) ? 'not_found' : 'resume_failed',
      status: /not found/i.test(message) ? 404 : 400,
    }), { fallback: 'Failed to resume browser chat verification' });
  }
}

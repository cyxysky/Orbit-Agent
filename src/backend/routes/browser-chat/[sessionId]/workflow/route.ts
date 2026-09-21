import { z } from 'zod';
import { getBrowserChatSession, sendBrowserChatMessage } from '@/server/ai/agents/browser-chat.service';
import { readWorkflow, reviewWorkflow } from '@/server/ai/agents/workflow-plan';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { apiError, apiJson, parseJsonRequest, ApiRequestError } from '@/server/http/api-request';
import type { BrowserChatSessionRouteContext } from '@/server/http/browser-chat-route';
import { queryDatabaseOne } from '@/server/db/database';

async function authorize(request: Request, sessionId: string) {
  const userId = requestApplicationUserId(request);
  const session = await getBrowserChatSession(sessionId, userId);
  if (!session) throw new ApiRequestError('Session not found', { status: 404, code: 'not_found' });
  return { userId, session };
}
export async function GET(request: Request, context: BrowserChatSessionRouteContext) {
  try {
    const { sessionId } = await context.params;
    const userId = requestApplicationUserId(request);
    const owner = await queryDatabaseOne('SELECT id FROM browser_chat_session WHERE id = ? AND user_id = ?', [sessionId, userId]);
    if (!owner) throw new ApiRequestError('Session not found', { status: 404, code: 'not_found' });
    return apiJson(request, { plan: await readWorkflow(sessionId) || null });
  } catch (error) { return apiError(request, error, { fallback: 'Unable to read plan' }); }
}
export async function POST(request: Request, context: BrowserChatSessionRouteContext) {
  try {
    const { sessionId } = await context.params;
    const { userId, session } = await authorize(request, sessionId);
    if (session.busy) throw new ApiRequestError('请等待当前操作结束后审核。', { status: 409, code: 'busy' });
    const input = await parseJsonRequest(request, z.object({
      revision: z.number().int().positive(), submissionId: z.string().uuid(),
      decision: z.enum(['approve', 'accept_with_gaps', 'request_changes', 'cancel']),
      feedback: z.string().max(8000).default(''), reopenIds: z.array(z.string()).max(1000).default([]),
    }).strict(), { maxBytes: 32000 });
    const plan = await reviewWorkflow(sessionId, String(userId), input.revision, input.submissionId, input.decision, input.feedback, input.reopenIds);
    // The deterministic message ID makes retries safe if scheduling failed after the review committed.
    if (plan.status === 'active') await sendBrowserChatMessage(sessionId,
      input.decision === 'request_changes' ? `用户已通过计划审核卡反馈问题，请读取 workflow 并修正当前阶段：${input.feedback}` : '用户已通过计划审核卡确认上一阶段，请读取 workflow，按任务约定继续。',
      undefined, undefined, undefined, `workflow-review-${input.submissionId}`, undefined, undefined, userId);
    return apiJson(request, { plan });
  } catch (error) { return apiError(request, error, { fallback: 'Unable to review plan' }); }
}

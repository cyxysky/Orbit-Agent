import { z } from 'zod';
import { getBrowserChatSession, requestBrowserChatMemoryExtraction } from '@/server/ai/agents/browser-chat.service';
import { listMemoryCandidates, reviewMemoryProposal } from '@/server/ai/runtime-memory-lifecycle';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { apiError, apiJson, parseJsonRequest, ApiRequestError } from '@/server/http/api-request';
import type { BrowserChatSessionRouteContext } from '@/server/http/browser-chat-route';

async function sessionFor(request: Request, sessionId: string) {
  const session = await getBrowserChatSession(sessionId, requestApplicationUserId(request));
  if (!session) throw new ApiRequestError('Session not found', { status: 404, code: 'not_found' });
  return session;
}
export async function GET(request: Request, context: BrowserChatSessionRouteContext) {
  try {
    const { sessionId } = await context.params;
    await sessionFor(request, sessionId);
    return apiJson(request, { candidates: await listMemoryCandidates(sessionId, String(requestApplicationUserId(request))) });
  } catch (error) { return apiError(request, error, { fallback: '无法读取记忆候选' }); }
}
export async function POST(request: Request, context: BrowserChatSessionRouteContext) {
  let action: 'memory-extract' | 'memory-review' | undefined;
  try {
    const { sessionId } = await context.params;
    const session = await sessionFor(request, sessionId);
    if (session.busy) throw new ApiRequestError('请等待当前操作停止后处理记忆。', { status: 409, code: 'busy' });
    const input = await parseJsonRequest(request, z.union([z.object({ action: z.literal('memory-review'), id: z.string().length(64), approved: z.boolean() }).strict(),
    z.object({ action: z.literal('memory-extract') }).strict()]), { maxBytes: 8000 });
    action = input.action;
    const userId = String(requestApplicationUserId(request));
    if (input.action === 'memory-extract') return apiJson(request, await requestBrowserChatMemoryExtraction(sessionId, userId));
    await reviewMemoryProposal(sessionId, userId, input.id, input.approved);
    return apiJson(request, { reviewed: true });
  } catch (error) { return apiError(request, error, { fallback: action === 'memory-extract' ? '记忆提炼失败，请稍后重试。' : '无法保存记忆审核结果' }); }
}

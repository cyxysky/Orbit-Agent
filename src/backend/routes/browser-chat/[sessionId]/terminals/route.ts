import { terminalHttpResponse } from '@cjfclonedeep/capability-sdk/execution/terminal/http';
import { conversationTerminals } from '@/server/capabilities/terminal-manager';
import { queryDatabaseOne } from '@/server/db/database';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { ApiRequestError, apiError } from '@/server/http/api-request';
import type { BrowserChatSessionRouteContext } from '@/server/http/browser-chat-route';

async function authorizedManager(request: Request, context: BrowserChatSessionRouteContext) {
  const { sessionId } = await context.params;
  const userId = requestApplicationUserId(request);
  const session = await queryDatabaseOne<{ status: string }>(
    'SELECT status FROM browser_chat_session WHERE id = ? AND user_id = ?', [sessionId, userId],
  );
  if (!session) throw new ApiRequestError('对话不存在。', { code: 'not_found', status: 404 });
  return { manager: conversationTerminals.get({ runId: sessionId, userId, configuration: process.env }),
    closed: session.status === 'closed' };
}

async function handle(request: Request, context: BrowserChatSessionRouteContext) {
  try {
    const { manager, closed } = await authorizedManager(request, context);
    return terminalHttpResponse(request, manager, { enabled: process.env.AGENT_TERMINAL_ENABLED === 'true', closed });
  } catch (error) { return apiError(request, error, { fallback: '终端请求失败' }); }
}
export const GET = handle;
export const POST = handle;

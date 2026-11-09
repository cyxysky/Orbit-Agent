import { runtimeConfiguration } from '@/server/settings/runtime-configuration';
import { terminalHttpResponse, createPollingTerminalHttpOperations } from '@cjfclonedeep/capability-sdk/execution/terminal/http';
import { managedToolConnector } from '@/server/capabilities/managed-tools';
import type { CapabilityResult } from '@cjfclonedeep/capability-sdk';
import type { TerminalResult } from '@cjfclonedeep/capability-sdk/execution/terminal';
import { randomUUID } from 'node:crypto';
import { queryDatabaseOne } from '@/server/db/database';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { ApiRequestError, apiError } from '@/server/http/api-request';
import type { BrowserChatSessionRouteContext } from '@/server/http/browser-chat-route';
import { ERROR_CODES } from '@cjfclonedeep/capability-sdk';
import { isRuntimeToolEnabled } from '@/server/runtime/self-bootstrap-policy';


async function authorizedManager(request: Request, context: BrowserChatSessionRouteContext) {
  if (!isRuntimeToolEnabled('terminal', runtimeConfiguration())) {
    throw new ApiRequestError('当前部署已禁用本地终端。', { status: 403 });
  }
  const { sessionId } = await context.params;
  const userId = requestApplicationUserId(request);
  const session = await queryDatabaseOne<{ status: string }>(
    'SELECT status FROM browser_chat_session WHERE id = ? AND user_id = ?', [sessionId, userId],
  );
  if (!session) throw new ApiRequestError('对话不存在。', { code: ERROR_CODES.NOT_FOUND, status: 404 });
  const connector = await managedToolConnector({ id: 'terminal', userId, sessionId, runId: sessionId, observe: request.method === 'GET' });
  const manager = createPollingTerminalHttpOperations(async input => {
    const raw = await connector.call('terminal', { ...input, detail: true }, { invocationId: randomUUID(), abortSignal: request.signal }) as { structuredContent?: CapabilityResult<TerminalResult> };
    const result = raw.structuredContent;
    if (!result || !result.ok && !result.data) throw new Error(result && !result.ok ? result.error.message : 'Invalid terminal MCP response.');
    return result.data || {};
  });
  return { manager,
    closed: session.status === 'closed' };
}

async function handle(request: Request, context: BrowserChatSessionRouteContext) {
  try {
    const { manager, closed } = await authorizedManager(request, context);
    return await terminalHttpResponse(request, manager, { enabled: true, closed });
  } catch (error) { return apiError(request, error, { fallback: '终端请求失败' }); }
}
export const GET = handle;
export const POST = handle;

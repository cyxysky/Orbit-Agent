import { readBrowserChatSessionOwner } from '@/server/storage/browser-chat-history-store';
import { queryDatabaseOne } from '@/server/db/database';
import { conversationRecords } from '@/server/storage/record-sources';
import { normalizeApplicationUserId, requestApplicationUserId } from '@/server/auth/user-context';
import { ApiRequestError, apiError, apiJson } from '@/server/http/api-request';
import type { BrowserChatSessionRouteContext } from '@/server/http/browser-chat-route';
import { ERROR_CODES } from '@cjfclonedeep/capability-sdk';



export async function GET(request: Request, context: BrowserChatSessionRouteContext) {
  try {
    const { sessionId } = await context.params;
    const userId = requestApplicationUserId(request);
    const owner = await readBrowserChatSessionOwner(sessionId);
    if (!owner || normalizeApplicationUserId(owner.userId) !== normalizeApplicationUserId(userId)) {
      throw new ApiRequestError('Browser chat session not found', { code: ERROR_CODES.NOT_FOUND, status: 404 });
    }
    const requestId = new URL(request.url).searchParams.get('requestId') || '';
    const row = await queryDatabaseOne<{ manifest_json: string }>(
      `SELECT record_json AS manifest_json FROM ${conversationRecords('request')} WHERE session_id = ? AND id = ?`, [sessionId, requestId],
    );
    if (!row) throw new ApiRequestError('Context request not found', { code: ERROR_CODES.NOT_FOUND, status: 404 });
    return apiJson(request, { manifest: JSON.parse(row.manifest_json) });
  } catch (error) {
    return apiError(request, error, { fallback: 'Failed to read context request' });
  }
}

import { ResponseOperationError } from '@webpilot/capability-sdk';
import { responseRegistry } from '@/lib/response-registry';
import { responseHandlers } from './response-handlers';
import { readBrowserChatRuntimeState } from '@/server/ai/agents/browser-chat-read.service';
import { getAutomationRun } from '@/server/storage/automation-store';
import { requestApplicationUserId, normalizeApplicationUserId } from '@/server/auth/user-context';
import { ApiRequestError, apiError, apiJson } from '@/server/http/api-request';

export async function responseOperation(request: Request, scopeId: string, automation = false) {
  try {
    // All operations use explicit POSTs; rendering a saved map can incur a provider lookup.
    if (request.headers.get('sec-fetch-site') === 'cross-site') throw new ApiRequestError('Invalid request origin', { status: 403 });
    const userId = normalizeApplicationUserId(requestApplicationUserId(request));
    const owner = automation ? await getAutomationRun(scopeId, userId) : await readBrowserChatRuntimeState(scopeId, userId);
    if (!owner) throw new ApiRequestError('Session not found', { status: 404, code: 'not_found' });
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        size += result.value.byteLength;
        if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new ApiRequestError('内容请求过大。', { status: 413 }); }
        chunks.push(result.value);
      }
    } finally { reader.releaseLock(); }
    let body: { block: ReturnType<typeof responseRegistry.parse>; operation: string; input?: unknown };
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['block', 'operation', 'input'].includes(key)) || typeof value.operation !== 'string') throw new Error('Invalid operation.');
      body = { ...value, block: responseRegistry.parse(value.block) };
    } catch { throw new ApiRequestError('内容请求参数无效。', { status: 400 }); }
    const data = await responseHandlers.execute(body.block, body.operation, body.input, { scopeId, userId, readOnly: automation, signal: request.signal });
    return apiJson(request, { data });
  } catch (error) {
    return apiError(request, error instanceof ResponseOperationError ? new ApiRequestError(error.message, { status: error.status }) : error,
      { fallback: '内容操作失败。' });
  }
}

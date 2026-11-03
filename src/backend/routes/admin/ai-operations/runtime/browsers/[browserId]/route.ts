import { requireAiOperationsAdmin } from '@/server/auth/ai-operations-admin';
import { closeBrowserChatRuntimeBrowser } from '@/server/ai/agents/browser-chat.service';
import { ApiRequestError, apiError, apiJson } from '@/server/http/api-request';
import { ERROR_CODES } from '@cjfclonedeep/capability-sdk';



export async function DELETE(request: Request, context: { params: Promise<{ browserId: string }> }) {
  try {
    requireAiOperationsAdmin(request);
    const { browserId } = await context.params;
    const closed = await closeBrowserChatRuntimeBrowser(decodeURIComponent(browserId));
    if (!closed) throw new ApiRequestError('Test browser was not found or is already closed.', { code: ERROR_CODES.BROWSER_NOT_FOUND, status: 404 });
    return apiJson(request, { closed: true });
  } catch (error) {
    return apiError(request, error, { fallback: 'Unable to close test browser', status: 500 });
  }
}

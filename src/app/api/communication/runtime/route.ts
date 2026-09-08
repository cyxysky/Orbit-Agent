import { startCommunicationRuntime } from '@/server/integrations/communication-runtime';
import { ApiRequestError, apiError, apiJson } from '@/server/http/api-request';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const expected = String(process.env.WEBPILOT_INTERNAL_REQUEST_TOKEN || '');
    if (!expected || request.headers.get('x-webpilot-internal-token') !== expected) {
      throw new ApiRequestError('Not found', { code: 'not_found', status: 404 });
    }
    startCommunicationRuntime();
    return apiJson(request, { ok: true });
  } catch (error) {
    return apiError(request, error, { fallback: '无法启动机器人消息接收服务' });
  }
}

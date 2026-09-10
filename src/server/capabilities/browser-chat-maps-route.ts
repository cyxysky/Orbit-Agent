import { MapsError, mapIdSchema } from '@webpilot/capability-maps';
import { readBrowserChatRuntimeState } from '@/server/ai/agents/browser-chat-read.service';
import { getAutomationRun } from '@/server/storage/automation-store';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { ApiRequestError, apiError, apiJson } from '@/server/http/api-request';
import { resolveBrowserChatMap } from './browser-chat-maps';
import { store } from '@/server/db/store';

export async function mapViewResponse(request: Request, scopeId: string, mapId: string, automation = false) {
  try {
    // Billable lookups require an explicit same-origin POST, never a prefetchable GET.
    if (request.headers.get('sec-fetch-site') === 'cross-site') throw new ApiRequestError('Invalid request origin', { status: 403 });
    if (!mapIdSchema.safeParse(mapId).success) throw new ApiRequestError('Invalid map id');
    const userId = requestApplicationUserId(request);
    const owner = automation ? await getAutomationRun(scopeId, userId) : await readBrowserChatRuntimeState(scopeId, userId);
    if (!owner) throw new ApiRequestError('Session not found', { status: 404, code: 'not_found' });
    await store.applyRuntimeEnv();
    const map = await resolveBrowserChatMap(scopeId, mapId, request.signal);
    if (!map) throw new ApiRequestError('Map not found', { status: 404, code: 'not_found' });
    return apiJson(request, map);
  } catch (error) {
    const known = error instanceof MapsError ? new ApiRequestError(error.message, { code: error.code, status: error.code === 'maps-monthly-limit' ? 429 : 400 }) : error;
    return apiError(request, known, { fallback: '无法加载地图，请检查配置或稍后手动重试。' });
  }
}

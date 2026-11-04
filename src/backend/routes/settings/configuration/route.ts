import { apiError, apiJson, parseJsonRequest } from '@/server/http/api-request';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { configurationCatalog, configurationRequestSchema, manageConfiguration } from '@/server/settings/configuration-service';
import { store } from '@/server/db/store';
import { idempotencyFingerprint, runIdempotentJson } from '@/server/http/idempotency';

export async function GET(request: Request) {
  try {
    await store.refreshRuntimeSettings();
    return apiJson(request, await configurationCatalog());
  } catch (error) { return apiError(request, error, { fallback: '读取配置目录失败' }); }
}

export async function POST(request: Request) {
  try {
    const input = await parseJsonRequest(request, configurationRequestSchema, { maxBytes: 512 * 1024 });
    const userId = requestApplicationUserId(request);
    return await runIdempotentJson(request, { fingerprint: idempotencyFingerprint(input), scope: 'settings.configuration', userId }, async () =>
      apiJson(request, await manageConfiguration(input, { userId, model: false })));
  } catch (error) { return apiError(request, error, { fallback: '配置操作失败' }); }
}

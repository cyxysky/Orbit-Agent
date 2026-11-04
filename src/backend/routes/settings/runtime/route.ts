import { z } from 'zod';
import { configurationDefinitions } from '@/server/settings/settings-registry';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { saveRuntimeConfiguration } from '@/server/settings/configuration-service';
import { ApiRequestError, apiError, apiJson, parseJsonRequest } from '@/server/http/api-request';
import { idempotencyFingerprint, runIdempotentJson } from '@/server/http/idempotency';
import { requestHasAdminSettingsAccess } from '@/server/settings/admin-settings-access';
import { readRuntimeSettingsItems } from '@/server/settings/settings-snapshot';
import { ERROR_CODES } from '@cjfclonedeep/capability-sdk';


const runtimeSettingsSchema = z.object({
  items: z.array(z.object({
    key: z.string().max(200),
    value: z.unknown().optional(),
  }).passthrough()).max(500),
}).strict();

function requireAdmin(request: Request) {
  if (!requestHasAdminSettingsAccess(request)) {
    throw new ApiRequestError('请先输入管理员设置密码。', { code: ERROR_CODES.ADMIN_ACCESS_REQUIRED, status: 401 });
  }
}

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    return apiJson(request, { saved: await readRuntimeSettingsItems(), definitions: configurationDefinitions() });
  } catch (error) {
    return apiError(request, error, { fallback: '读取运行配置失败' });
  }
}

export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const body = await parseJsonRequest(request, runtimeSettingsSchema, { maxBytes: 256 * 1024 });
    const userId = requestApplicationUserId(request);
    return await runIdempotentJson(request, {
      fingerprint: idempotencyFingerprint(body),
      scope: 'settings.runtime',
      userId,
    }, async () => {
      await saveRuntimeConfiguration(Object.fromEntries(body.items.filter(item => item.value !== undefined).map(item => [item.key, item.value])));
      return apiJson(request, { ok: true, saved: await readRuntimeSettingsItems(), definitions: configurationDefinitions() });
    });
  } catch (error) {
    return apiError(request, error, { fallback: '保存运行配置失败' });
  }
}

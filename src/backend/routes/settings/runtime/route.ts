import { runtimeSetting } from '@/server/settings/runtime-configuration';
import { z } from 'zod';
import { normalizeRuntimeSettingValue, runtimeSettingDefinitions } from '@/config/settings';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { store } from '@/server/db/store';
import { ApiRequestError, apiError, apiJson, parseJsonRequest } from '@/server/http/api-request';
import { idempotencyFingerprint, runIdempotentJson } from '@/server/http/idempotency';
import { requestHasAdminSettingsAccess } from '@/server/settings/admin-settings-access';
import { readRuntimeSettingsItems } from '@/server/settings/settings-snapshot';
import { ERROR_CODES } from '@cjfclonedeep/capability-sdk';


const allowedKeys = new Set(runtimeSettingDefinitions.map((item) => item.key));
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
    return apiJson(request, { saved: await readRuntimeSettingsItems() });
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
      if (body.items.some(item => !allowedKeys.has(item.key))) throw new ApiRequestError('包含未注册的运行配置。');
      const incomingByKey = new Map(body.items.map((item) => [item.key, item]));
      const savedByKey = new Map((await store.listRuntimeSettings()).map((item) => [item.key, item]));
      const sanitized = runtimeSettingDefinitions.filter(definition => incomingByKey.has(definition.key)).map((definition) => {
        const item = incomingByKey.get(definition.key);
        const secret = Boolean(definition.secret);
        let value = savedByKey.get(definition.key)?.value ?? runtimeSetting(definition.key) ?? definition.defaultValue;
        if (typeof item?.value === 'string' && (!secret || item.value)) {
          try {
            value = normalizeRuntimeSettingValue(definition, item.value);
          } catch (error) {
            throw new ApiRequestError(error instanceof Error ? error.message : '配置值无效');
          }
        }
        return {
          key: definition.key,
          value,
          enabled: true,
          secret,
        };
      });
      await store.saveRuntimeSettings(sanitized);
      await store.refreshRuntimeSettings();
      return apiJson(request, { ok: true, saved: await readRuntimeSettingsItems() });
    });
  } catch (error) {
    return apiError(request, error, { fallback: '保存运行配置失败' });
  }
}

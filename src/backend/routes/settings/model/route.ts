import { z } from 'zod';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { ApiRequestError, apiError, apiJson, parseJsonRequest } from '@/server/http/api-request';
import { idempotencyFingerprint, runIdempotentJson } from '@/server/http/idempotency';
import { requestHasAdminSettingsAccess } from '@/server/settings/admin-settings-access';
import { readModelSettingsState } from '@/server/settings/settings-snapshot';
import { saveModelSettings } from '@/server/settings/model-settings';
import { ERROR_CODES } from '@cjfclonedeep/capability-sdk';
const modelBodySchema = z.record(z.string(), z.unknown());
function requireAdmin(request: Request) {
  if (!requestHasAdminSettingsAccess(request)) throw new ApiRequestError('Administrator access required.', { code: ERROR_CODES.ADMIN_ACCESS_REQUIRED, status: 401 });
}

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    return apiJson(request, await readModelSettingsState());
  } catch (error) {
    return apiError(request, error, { fallback: '读取模型配置失败' });
  }
}

export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const body = await parseJsonRequest(request, modelBodySchema, { maxBytes: 512 * 1024 });
    const userId = requestApplicationUserId(request);
    return await runIdempotentJson(request, {
      fingerprint: idempotencyFingerprint(body),
      scope: 'settings.model',
      userId,
    }, async () => {
      await saveModelSettings(body);
      return apiJson(request, { ok: true, ...await readModelSettingsState() });
    });
  } catch (error) {
    return apiError(request, error, { fallback: '保存模型配置失败' });
  }
}

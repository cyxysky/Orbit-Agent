import { requestApplicationUserId } from '@/server/auth/user-context';
import { requestHasAdminSettingsAccess } from '@/server/settings/admin-settings-access';
import { readEnvironmentSettingsSnapshot } from '@/server/settings/settings-snapshot';
import { ApiRequestError, apiJson, apiError } from '@/server/http/api-request';

export async function GET(request: Request) {
  try {
    requestApplicationUserId(request);
    if (!requestHasAdminSettingsAccess(request)) throw new ApiRequestError('请先输入管理员设置密码。', { status: 401 });
    return apiJson(request, await readEnvironmentSettingsSnapshot());
  } catch (error) { return apiError(request, error, { fallback: '读取设置失败' }); }
}

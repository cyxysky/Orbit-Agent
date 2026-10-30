import { sensitiveDataRuntimeInstaller } from '@/server/capabilities/sensitive-data-runtime';
import { ApiRequestError, apiError, apiJson } from '@/server/http/api-request';
import { requestHasAdminSettingsAccess } from '@/server/settings/admin-settings-access';

async function handle(request: Request, install: boolean) {
  try {
    if (!requestHasAdminSettingsAccess(request)) {
      throw new ApiRequestError('请先输入管理员设置密码。', { code: 'admin_access_required', status: 401 });
    }
    const installer = sensitiveDataRuntimeInstaller();
    return apiJson(request, { runtime: install ? installer.start() : installer.status() });
  } catch (error) {
    return apiError(request, error, { fallback: '读取或下载本地脱敏组件失败' });
  }
}
export const GET = (request: Request) => handle(request, false);
export const POST = (request: Request) => handle(request, true);

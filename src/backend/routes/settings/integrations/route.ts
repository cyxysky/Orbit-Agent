import { z } from 'zod';
import { categorySchema, integrationSchema, saveIntegrationSettings } from '@/server/settings/integration-settings';
import {
  deleteExternalIntegration,
  listExternalIntegrations,
} from '@/server/integrations/external-integration-vault';
import {
  listExternalIntegrationDrivers,
  publicExternalIntegrationSummary,
} from '@/server/integrations/external-integration-drivers';
import { ApiRequestError, apiError, apiJson, parseJsonRequest } from '@/server/http/api-request';
import { requestHasAdminSettingsAccess } from '@/server/settings/admin-settings-access';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { refreshCommunicationRuntime, startCommunicationRuntime } from '@/server/integrations/communication-runtime';
import { ERROR_CODES } from '@cjfclonedeep/capability-sdk';


function requireAdmin(request: Request) {
  if (!requestHasAdminSettingsAccess(request)) {
    throw new ApiRequestError('请先输入管理员设置密码。', { code: ERROR_CODES.ADMIN_ACCESS_REQUIRED, status: 401 });
  }
}

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    startCommunicationRuntime();
    const requestedCategory = new URL(request.url).searchParams.get('category');
    const category = requestedCategory ? categorySchema.parse(requestedCategory) : undefined;
    const integrations = await listExternalIntegrations(category);
    return apiJson(request, {
      items: integrations.map(publicExternalIntegrationSummary),
      drivers: listExternalIntegrationDrivers(category),
    });
  } catch (error) {
    return apiError(request, error, { fallback: '读取外部集成失败' });
  }
}

export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const body = await parseJsonRequest(request, integrationSchema, { maxBytes: 128 * 1024 });
    const item = await saveIntegrationSettings(body, requestApplicationUserId(request));
    return apiJson(request, { ok: true, item: publicExternalIntegrationSummary(item) });
  } catch (error) {
    return apiError(request, error, { fallback: '保存外部集成失败' });
  }
}

export async function DELETE(request: Request) {
  try {
    requireAdmin(request);
    const id = new URL(request.url).searchParams.get('id')?.trim();
    if (!id || !z.string().uuid().safeParse(id).success) {
      throw new ApiRequestError('外部集成 ID 无效。', { code: ERROR_CODES.INVALID_INTEGRATION_ID });
    }
    if (!(await deleteExternalIntegration(id))) {
      throw new ApiRequestError('外部集成不存在。', { code: ERROR_CODES.INTEGRATION_NOT_FOUND, status: 404 });
    }
    await refreshCommunicationRuntime();
    return apiJson(request, { ok: true });
  } catch (error) {
    return apiError(request, error, { fallback: '删除外部集成失败' });
  }
}

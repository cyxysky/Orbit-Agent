import { runtimeSetting } from '@/server/settings/runtime-configuration';
import { z } from 'zod';
import { runtimeSettingDefinitions } from '@/config/settings';
import { store } from '@/server/db/store';
import { ApiRequestError, apiError, apiJson, parseJsonRequest } from '@/server/http/api-request';
import { requestHasAdminSettingsAccess } from '@/server/settings/admin-settings-access';
import { resolveExternalIntegration } from '@/server/integrations/external-integration-vault';
import { externalIntegrationDriver } from '@/server/integrations/external-integration-drivers';
import { ERROR_CODES } from '@cjfclonedeep/capability-sdk';


const sourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('provider'), provider: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal('runtime'), key: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal('integration'), id: z.string().uuid(), field: z.string().min(1).max(100) }).strict(),
]);

export async function POST(request: Request) {
  try {
    if (!requestHasAdminSettingsAccess(request)) {
      throw new ApiRequestError('请先输入管理员设置密码。', { code: ERROR_CODES.ADMIN_ACCESS_REQUIRED, status: 401 });
    }
    const source = await parseJsonRequest(request, sourceSchema, { maxBytes: 2048 });
    let value: string | undefined;
    if (source.kind === 'provider') {
      value = Object.entries((await store.getModelConfig())?.providers || {})
        .find(([provider]) => provider === source.provider)?.[1]?.apiKey;
    } else if (source.kind === 'runtime') {
      const definition = runtimeSettingDefinitions.find(item => item.key === source.key && item.secret);
      if (definition) value = (await store.listRuntimeSettings()).find(item => item.key === source.key)?.value
        ?? runtimeSetting(source.key) ?? definition.defaultValue;
    } else {
      const integration = await resolveExternalIntegration(source.id);
      if (integration && externalIntegrationDriver(integration.driverId, integration.category).fields
        .some(field => field.key === source.field && field.secret)) value = integration.configuration[source.field];
    }
    if (!value) throw new ApiRequestError('该密钥尚未配置或已被清除。', { status: 404 });
    return apiJson(request, { value });
  } catch (error) {
    return apiError(request, error, { fallback: '读取密钥失败' });
  }
}

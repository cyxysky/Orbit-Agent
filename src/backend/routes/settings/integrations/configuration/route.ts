import { requireAiOperationsAdmin } from '@/server/auth/ai-operations-admin';
import { authorizeAdminSettingsRequest } from '@/server/settings/admin-settings-access';
import { apiError, apiJson, parseJsonRequest } from '@/server/http/api-request';
import { readIntegrationToolSettings, saveIntegrationToolSettings, toolSettingsQuerySchema, toolSettingsSaveSchema } from '@/server/settings/integration-tool-settings';

export async function GET(request: Request) {
  try {
    requireAiOperationsAdmin(request);
    const denied = authorizeAdminSettingsRequest(request);
    if (denied) return denied;
    const query = toolSettingsQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return apiJson(request, await readIntegrationToolSettings(query, request.signal));
  } catch (error) { return apiError(request, error, { fallback: '读取 MCP 工具配置失败' }); }
}
export async function POST(request: Request) {
  try {
    requireAiOperationsAdmin(request);
    const denied = authorizeAdminSettingsRequest(request);
    if (denied) return denied;
    const body = await parseJsonRequest(request, toolSettingsSaveSchema, { maxBytes: 64 * 1024 });
    return apiJson(request, { ok: true, ...await saveIntegrationToolSettings(body, request.signal) });
  } catch (error) { return apiError(request, error, { fallback: '保存 MCP 工具配置失败；如请求中断，请重新读取确认当前值。' }); }
}

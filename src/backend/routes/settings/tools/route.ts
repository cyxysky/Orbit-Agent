import { z } from 'zod';
import { requireAiOperationsAdmin } from '@/server/auth/ai-operations-admin';
import { authorizeAdminSettingsRequest } from '@/server/settings/admin-settings-access';
import { apiError, apiJson, parseJsonRequest } from '@/server/http/api-request';
import { listManagedTools, managedToolConfigurations, saveManagedToolConfiguration, stopManagedTool, toolInstaller } from '@/server/capabilities/managed-tools';

const value = z.object({ enabled: z.boolean(), env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(20000)).refine(v => Object.keys(v).length <= 100), config: z.record(z.string(), z.unknown()) });
const input = z.object({ id: z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/), action: z.enum(['install', 'uninstall', 'stop', 'configure']),
  configuration: value.optional(), clearEnv: z.array(z.string()).max(100).optional() }).strict();
function authorize(request: Request) { requireAiOperationsAdmin(request); return authorizeAdminSettingsRequest(request); }
export async function GET(request: Request) {
  try { const denied = authorize(request); if (denied) return denied; return apiJson(request, { tools: await listManagedTools() }); }
  catch (error) { return apiError(request, error, { fallback: '读取工具组件失败' }); }
}
export async function POST(request: Request) {
  try {
    const denied = authorize(request); if (denied) return denied;
    const body = await parseJsonRequest(request, input, { maxBytes: 128 * 1024 });
    const installer = toolInstaller();
    installer.status(body.id); // Reject unknown/all ids before any mutation.
    if (body.action === 'install') {
      const configured = (await managedToolConfigurations())[body.id];
      return apiJson(request, { tool: installer.start(body.id, configured) });
    }
    if (body.action === 'stop') { await stopManagedTool(body.id, { force: true }); return apiJson(request, { ok: true }); }
    if (body.action === 'uninstall') {
      await stopManagedTool(body.id);
      await saveManagedToolConfiguration(body.id, { enabled: false, env: {}, config: {} });
      return apiJson(request, { tool: await installer.uninstall(body.id) });
    }
    if (!body.configuration) throw new Error('缺少工具配置');
    const previous = (await managedToolConfigurations())[body.id];
    const env = { ...previous?.env, ...body.configuration.env };
    for (const key of body.clearEnv || []) delete env[key];
    if (body.configuration.enabled && !installer.installed(body.id)) throw new Error('请先安装此工具，再启用。');
    await saveManagedToolConfiguration(body.id, { ...body.configuration, env });
    return apiJson(request, { ok: true });
  } catch (error) { return apiError(request, error, { fallback: '更新工具组件失败' }); }
}

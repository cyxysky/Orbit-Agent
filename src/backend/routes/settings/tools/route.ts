import { setTimeout as delay } from 'node:timers/promises';
import { requireAiOperationsAdmin } from '@/server/auth/ai-operations-admin';
import { authorizeAdminSettingsRequest } from '@/server/settings/admin-settings-access';
import { apiError, apiJson, parseJsonRequest } from '@/server/http/api-request';
import { listManagedTools, toolInstaller } from '@/server/capabilities/managed-tools';
import { manageTools } from '@/server/capabilities/tool-management';
import { managedToolManagementSchema } from '@/config/managed-tool-management';

export async function GET(request: Request) {
  try {
    requireAiOperationsAdmin(request);
    const denied = authorizeAdminSettingsRequest(request); if (denied) return denied;
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (url.searchParams.get('stream') !== '1' || !id) return apiJson(request, { tools: await listManagedTools() });
    const installer = toolInstaller();
    installer.status(id);
    const abort = new AbortController();
    const signal = AbortSignal.any([request.signal, abort.signal]);
    const encoder = new TextEncoder();
    let previous = '';
    return new Response(new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          while (!signal.aborted) {
            const tool = installer.status(id);
            const data = JSON.stringify({ tool });
            if (data !== previous) {
              controller.enqueue(encoder.encode(data + '\n')); previous = data;
              if (tool.state !== 'installing') controller.close();
              return;
            }
            await delay(250, undefined, { signal });
          }
        } catch (error) {
          if (!signal.aborted) { controller.enqueue(encoder.encode(JSON.stringify({ error: error instanceof Error ? error.message : '读取安装进度失败' }) + '\n')); controller.close(); }
        }
      },
      cancel() { abort.abort(); },
    }), { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no', 'x-content-type-options': 'nosniff' } });
  } catch (error) { return apiError(request, error, { fallback: '读取工具组件失败' }); }
}
export async function POST(request: Request) {
  try {
    const principal = requireAiOperationsAdmin(request);
    const denied = authorizeAdminSettingsRequest(request); if (denied) return denied;
    const body = await parseJsonRequest(request, managedToolManagementSchema, { maxBytes: 128 * 1024 });
    return apiJson(request, await manageTools(body, { userId: principal.userId, model: false, signal: request.signal }));
  } catch (error) { return apiError(request, error, { fallback: '更新工具组件失败' }); }
}

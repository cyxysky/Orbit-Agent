import { runtimeConfiguration } from '@/server/settings/runtime-configuration';
import { browserChatCapabilityToolCatalog } from '@/server/ai/agents/runtime-tool-catalog';
import { apiError, apiJson } from '@/server/http/api-request';
import { store } from '@/server/db/store';
import { readChatInterfaceSettings } from '@/lib/chat-interface-settings';
import { refreshExtensionToolCatalog } from '@/server/capabilities/extensions';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { isAiOperationsAdmin } from '@/server/auth/ai-operations-admin';
import { isExtensionToolName } from '@cjfclonedeep/capability-sdk/extensions';
import { listManagedTools } from '@/server/capabilities/managed-tools';

export async function GET(request: Request) {
  try {
    await store.refreshRuntimeSettings();
    await refreshExtensionToolCatalog();
    const admin = isAiOperationsAdmin(requestApplicationUserId(request));
    const components = await listManagedTools();
    const availability = new Map(components.map(tool => [tool.id, tool.state === 'ready' && tool.enabled]));
    const catalog = browserChatCapabilityToolCatalog().filter(tool =>
      (admin || (tool.name !== 'selfBootstrap' && !isExtensionToolName(tool.name))) && availability.get(tool.name) !== false);
    return apiJson(request, { tools: catalog, interfaceSettings: readChatInterfaceSettings(runtimeConfiguration()) });
  } catch (error) { return apiError(request, error, { fallback: '无法读取工具说明' }); }
}

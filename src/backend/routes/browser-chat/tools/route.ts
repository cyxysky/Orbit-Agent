import { runtimeConfiguration } from '@/server/settings/runtime-configuration';
import { browserChatCapabilityToolCatalog } from '@/server/ai/agents/runtime-tool-catalog';
import { apiError, apiJson } from '@/server/http/api-request';
import { store } from '@/server/db/store';
import { readChatInterfaceSettings } from '@/lib/chat-interface-settings';

export async function GET(request: Request) {
  try {
    await store.refreshRuntimeSettings();
    const catalog = browserChatCapabilityToolCatalog();
    return apiJson(request, { tools: catalog, interfaceSettings: readChatInterfaceSettings(runtimeConfiguration()) });
  } catch (error) { return apiError(request, error, { fallback: '无法读取工具说明' }); }
}

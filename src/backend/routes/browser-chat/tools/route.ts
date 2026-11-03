import { browserChatCapabilityToolCatalog } from '@/server/ai/agents/runtime-tool-catalog';
import { apiError, apiJson } from '@/server/http/api-request';
import { store } from '@/server/db/store';

export async function GET(request: Request) {
  try {
    await store.applyRuntimeEnv();
    const catalog = browserChatCapabilityToolCatalog();
    return apiJson(request, { tools: catalog });
  } catch (error) { return apiError(request, error, { fallback: '无法读取工具说明' }); }
}

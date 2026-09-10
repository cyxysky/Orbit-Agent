import { browserChatCapabilityToolCatalog } from '@/server/ai/agents/runtime-tool-catalog';
import { apiError, apiJson } from '@/server/http/api-request';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const catalog = browserChatCapabilityToolCatalog();
    return apiJson(request, { tools: catalog });
  } catch (error) { return apiError(request, error, { fallback: '无法读取工具说明' }); }
}

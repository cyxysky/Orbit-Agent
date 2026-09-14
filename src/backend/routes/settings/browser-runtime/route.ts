import { apiJson } from '@/server/http/api-request';
import { readRuntimeSettingsItems } from '@/server/settings/settings-snapshot';


const browserChatRuntimeKeys = new Set(['BROWSER_CHAT_SHOW_REASONING', 'ELECTRON_EMBEDDED_BROWSER']);

export async function GET(request: Request) {
  return apiJson(request, {
    saved: (await readRuntimeSettingsItems()).filter((item) => browserChatRuntimeKeys.has(item.key)),
  });
}

import { listBrowserChatToolConfirmations } from '@/server/ai/agents/browser-chat-read.service';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { apiJson } from '@/server/http/api-request';

export async function GET(request: Request) {
  return apiJson(request, {
    confirmations: await listBrowserChatToolConfirmations(requestApplicationUserId(request)),
  });
}

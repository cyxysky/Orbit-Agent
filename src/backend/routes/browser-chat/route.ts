import { listBrowserChatSessionSummaries } from '@/server/ai/agents/browser-chat-read.service';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { apiJson, boundedQueryInteger } from '@/server/http/api-request';


function requestUserId(request: Request) {
  return requestApplicationUserId(request);
}

export async function GET(request: Request) {
  const limit = boundedQueryInteger(new URL(request.url).searchParams.get('limit'), { fallback: 10, max: 100 });
  const page = await listBrowserChatSessionSummaries(requestUserId(request), {
    beforeId: new URL(request.url).searchParams.get('beforeId')?.trim() || undefined,
    beforeCreatedAt: new URL(request.url).searchParams.get('beforeCreatedAt')?.trim() || undefined,
    limit: limit + 1,
  });
  const sessions = page.slice(0, limit);
  const last = sessions.at(-1);
  return apiJson(request, {
    sessions,
    page: {
      hasMore: page.length > limit,
      next: page.length > limit && last ? { beforeId: last.id, beforeCreatedAt: last.createdAt } : undefined,
    },
  });
}

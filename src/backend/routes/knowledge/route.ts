import { requestApplicationUserId } from '@/server/auth/user-context';
import { withSharedKnowledgeStore } from '@/server/capabilities/knowledge-storage';
import { apiError, apiJson, boundedQueryInteger } from '@/server/http/api-request';

/** All application users can discover enabled public references without settings access. */
export async function GET(request: Request) {
  try {
    requestApplicationUserId(request);
    const query = new URL(request.url).searchParams;
    const limit = boundedQueryInteger(query.get('limit'), { fallback: 50, max: 100 });
    const offset = boundedQueryInteger(query.get('offset'), { fallback: 0, max: 1_000_000, min: 0 });
    return await withSharedKnowledgeStore(async store => {
      const packages = await store.packages(limit + 1, offset, true);
      return apiJson(request, { packages: packages.slice(0, limit), nextOffset: packages.length > limit ? offset + limit : null });
    });
  } catch (error) { return apiError(request, error, { fallback: '读取知识库失败' }); }
}

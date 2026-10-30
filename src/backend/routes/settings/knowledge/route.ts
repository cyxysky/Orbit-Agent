import { z } from 'zod';
import { createKnowledgePackageTemplate, parseKnowledgePackageArchive, knowledgePackageUploadLimit } from '@cjfclonedeep/capability-sdk/knowledge/node';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { withUserKnowledgeStore } from '@/server/capabilities/knowledge-storage';
import { ApiRequestError, apiError, apiJson, boundedQueryInteger, parseJsonRequest } from '@/server/http/api-request';

const packageId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/);
function failure(request: Request, error: unknown, fallback: string) {
  return apiError(request, error, { fallback });
}
export async function GET(request: Request) {
  try {
    const userId = requestApplicationUserId(request), query = new URL(request.url).searchParams;
    if (query.get('template') === '1') {
      const bytes = await createKnowledgePackageTemplate();
      return new Response(new Uint8Array(bytes).buffer, { headers: {
        'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="orbit-knowledge-package-template.zip"',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      } });
    }
    const limit = boundedQueryInteger(query.get('limit'), { fallback: 50, max: 100 });
    const offset = boundedQueryInteger(query.get('offset'), { fallback: 0, max: 1_000_000, min: 0 });
    return await withUserKnowledgeStore(userId, async store => {
      const packages = await store.packages(limit + 1, offset);
      return apiJson(request, { packages: packages.slice(0, limit), nextOffset: packages.length > limit ? offset + limit : null });
    });
  } catch (error) { return failure(request, error, '读取知识库失败'); }
}
export async function POST(request: Request) {
  try {
    const userId = requestApplicationUserId(request);
    const maximum = knowledgePackageUploadLimit + 1024 * 1024;
    if (Number(request.headers.get('content-length')) > maximum) throw new ApiRequestError('知识包不能超过 32 MB。', { status: 413 });
    if (!request.body) throw new ApiRequestError('请选择 ZIP 或 RAR 知识包。');
    const reader = request.body.getReader(), chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maximum) { await reader.cancel(); throw new ApiRequestError('知识包不能超过 32 MB。', { status: 413 }); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const form = await new Request(request.url, { method: 'POST', headers: request.headers, body: Buffer.concat(chunks) }).formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new ApiRequestError('请选择 ZIP 或 RAR 知识包。');
    let candidate;
    try { candidate = await parseKnowledgePackageArchive(new Uint8Array(await file.arrayBuffer()), file.name); }
    catch (error) { throw new ApiRequestError(error instanceof Error ? error.message : '知识包校验失败。', { code: 'invalid_knowledge_package' }); }
    return await withUserKnowledgeStore(userId, async store => {
      const pack = await store.importPackage(candidate);
      return apiJson(request, { package: pack });
    });
  } catch (error) { return failure(request, error, '导入知识包失败'); }
}
export async function PATCH(request: Request) {
  try {
    const userId = requestApplicationUserId(request);
    const body = await parseJsonRequest(request, z.object({ id: packageId, enabled: z.boolean() }).strict(), { maxBytes: 4096 });
    return await withUserKnowledgeStore(userId, async store => {
      if (!await store.setPackageEnabled(body.id, body.enabled)) throw new ApiRequestError('知识包不存在。', { status: 404 });
      return apiJson(request, { ok: true });
    });
  } catch (error) { return failure(request, error, '更新知识包失败'); }
}
export async function DELETE(request: Request) {
  try {
    const userId = requestApplicationUserId(request), id = packageId.parse(new URL(request.url).searchParams.get('id'));
    return await withUserKnowledgeStore(userId, async store => {
      if (!await store.deletePackage(id)) throw new ApiRequestError('知识包不存在。', { status: 404 });
      return apiJson(request, { ok: true });
    });
  } catch (error) { return failure(request, error, '删除知识包失败'); }
}

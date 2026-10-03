import { z } from 'zod';
import { videoEditDocumentSchema } from '@cjfclonedeep/capability-sdk/media/video-project';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { apiJson, apiError, parseJsonRequest } from '@/server/http/api-request';
import { openVideoProject, updateVideoProject, renderVideoProject } from '@/server/capabilities/video-projects';

const identity = { projectId: z.string().regex(/^video_[a-f0-9-]{36}$/), revision: z.number().int().positive() };
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('open'), sourceRef: z.string().min(1).max(8_000) }).strict(),
  z.object({ action: z.literal('save'), ...identity, document: videoEditDocumentSchema }).strict(),
  z.object({ action: z.literal('render'), ...identity }).strict(),
]);
export async function POST(request: Request) {
  try {
    const userId = requestApplicationUserId(request);
    const input = await parseJsonRequest(request, schema, { maxBytes: 600_000 });
    if (input.action === 'open') return apiJson(request, { project: await openVideoProject(input.sourceRef, userId, request.signal) });
    if (input.action === 'save') return apiJson(request, { project: await updateVideoProject(input.projectId, input.revision, input.document, userId, request.signal) });
    return apiJson(request, await renderVideoProject(input.projectId, input.revision, userId, request.signal));
  } catch (error) { return apiError(request, error, { fallback: '视频工程处理失败，请检查素材与时长后重试。' }); }
}

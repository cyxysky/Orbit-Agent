import { mapViewResponse } from '@/server/capabilities/browser-chat-maps-route';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ runId: string; mapId: string }> }) {
  const { runId, mapId } = await context.params;
  return mapViewResponse(request, runId, mapId, true);
}

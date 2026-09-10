import { mapViewResponse } from '@/server/capabilities/browser-chat-maps-route';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ sessionId: string; mapId: string }> }) {
  const { sessionId, mapId } = await context.params;
  return mapViewResponse(request, sessionId, mapId);
}

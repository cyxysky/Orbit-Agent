import { responseOperation } from '@/server/capabilities/response-route';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  return responseOperation(request, (await context.params).runId, true);
}

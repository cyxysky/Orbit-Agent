import { readExcalidrawFont } from '@webpilot/capability-chart/node';

export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  const bytes = await readExcalidrawFont((await context.params).path);
  if (!bytes) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' },
  });
}

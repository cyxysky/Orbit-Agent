import { randomUUID } from 'node:crypto';
import { terminalToolInput, type TerminalEvent } from './index.ts';
import type { NodeTerminalOperations } from './node.ts';

/** The host authenticates and resolves the workspace before calling this handler. */
export async function terminalHttpResponse(request: Request, manager: NodeTerminalOperations, options: { enabled: boolean; closed?: boolean }) {
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.method === 'POST') {
    try {
      const input = terminalToolInput.parse(await request.json());
      if (['create', 'run', 'write'].includes(input.action) && (!options.enabled || options.closed)) {
        return json({ error: options.closed ? 'Terminal workspace is closed.' : 'Local terminal is disabled.' }, 403);
      }
      return json(await manager.execute(input, { invocationId: randomUUID(), abortSignal: request.signal }));
    } catch (error) { return json({ error: error instanceof Error ? error.message : 'Terminal operation failed.' }, 400); }
  }
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  if (new URL(request.url).searchParams.get('stream') !== '1') return json({ terminals: manager.list(), enabled: options.enabled });
  let release = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder(); let stopped = false;
      let output: Extract<TerminalEvent, { type: 'output' }> | undefined;
      let outputTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => { if (!stopped) { release(); controller.close(); } };
      const send = (event: { type: string }) => {
        if (stopped) return;
        if ((controller.desiredSize ?? 0) < -64) { finish(); return; }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        if (event.type === 'reset') finish();
      };
      const flushOutput = () => {
        clearTimeout(outputTimer); outputTimer = undefined;
        const event = output; output = undefined;
        if (event) send(event);
      };
      const unsubscribe = manager.subscribe(event => {
        if (event.type !== 'output') { flushOutput(); send(event); return; }
        if (output && (output.terminalId !== event.terminalId || output.cursor !== event.startCursor)) flushOutput();
        output = output ? { ...output, output: output.output + event.output, cursor: event.cursor } : { ...event };
        if (output.output.length >= 32768) flushOutput();
        else outputTimer ??= setTimeout(flushOutput, 8);
      });
      const heartbeat = setInterval(() => send({ type: 'heartbeat' }), 15000);
      release = () => { if (stopped) return; stopped = true; clearInterval(heartbeat); clearTimeout(outputTimer); output = undefined; unsubscribe(); request.signal.removeEventListener('abort', finish); };
      request.signal.addEventListener('abort', finish, { once: true });
      const snapshot = { type: 'snapshot', enabled: options.enabled, terminals: manager.list().map(terminal => manager.read(terminal.terminalId, 0, true)) };
      send(snapshot);
      if (request.signal.aborted) finish();
    },
    cancel() { release(); },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-store, no-transform', 'X-Accel-Buffering': 'no' } });
}

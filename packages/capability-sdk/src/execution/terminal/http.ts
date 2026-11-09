import { randomUUID } from 'node:crypto';
import { terminalToolInput, type TerminalEvent, type TerminalResult, type TerminalSummary, type TerminalToolInput } from './index.ts';
import type { CapabilityExecutionContext } from '../../index.ts';

type TerminalHttpOperations = {
  execute(input: TerminalToolInput, context: CapabilityExecutionContext): Promise<TerminalResult>;
  list(): TerminalSummary[] | Promise<TerminalSummary[]>;
  read(id: string, cursor?: number, raw?: boolean): TerminalResult | Promise<TerminalResult>;
  subscribe(listener: (event: TerminalEvent) => void): () => void;
};

/** Adapt a remote terminal executor to the same HTTP/SSE display contract. */
export function createPollingTerminalHttpOperations(execute: (input: TerminalToolInput) => Promise<TerminalResult>): TerminalHttpOperations {
  const cursors = new Map<string, number>();
  const list = async () => (await execute({ action: 'list', reason: 'Read terminal workspace', detail: true })).terminals || [];
  const read = async (terminalId: string, cursor = 0, raw = true) => {
    const result = await execute({ action: 'read', terminalId, cursor, raw, detail: true, maxOutputChars: 32768, reason: 'Stream terminal output' });
    cursors.set(terminalId, result.cursor ?? cursor); return result;
  };
  return { execute: input => execute({ ...input, detail: true }), list, read,
    subscribe(listener) {
      let stopped = false, timer: ReturnType<typeof setTimeout>;
      const summaries = new Map<string, string>();
      async function poll() {
        let active = false;
        try {
          const terminals = await list();
          if (stopped) return;
          const ids = new Set(terminals.map(terminal => terminal.terminalId));
          for (const id of summaries.keys()) if (!ids.has(id)) { summaries.delete(id); cursors.delete(id); listener({ type: 'deleted', terminalId: id }); }
          for (const terminal of terminals) {
            active ||= terminal.status === 'running' || terminal.status === 'starting';
            const encoded = JSON.stringify(terminal);
            if (summaries.get(terminal.terminalId) !== encoded) { summaries.set(terminal.terminalId, encoded); listener({ type: 'state', terminal }); }
            const cursor = cursors.get(terminal.terminalId) || 0;
            if (terminal.cursor > cursor) {
              const result = await read(terminal.terminalId, cursor);
              if (stopped) return;
              if (result.output) listener({ type: 'output', terminalId: terminal.terminalId, output: result.output,
                startCursor: result.outputStartCursor ?? cursor, cursor: result.cursor ?? cursor });
            }
          }
        } catch { if (!stopped) listener({ type: 'reset' }); stopped = true; }
        if (!stopped) timer = setTimeout(() => void poll(), active ? 125 : 1000);
      }
      timer = setTimeout(() => void poll(), 250);
      return () => { stopped = true; clearTimeout(timer); cursors.clear(); summaries.clear(); };
    },
  };
}

/** The host authenticates and resolves the workspace before calling this handler. */
export async function terminalHttpResponse(request: Request, manager: TerminalHttpOperations, options: { enabled: boolean; closed?: boolean }) {
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.method === 'POST') {
    try {
      const input = terminalToolInput.parse(await request.json());
      if (['exec', 'create', 'run', 'write'].includes(input.action) && (!options.enabled || options.closed)) {
        return json({ error: options.closed ? 'Terminal workspace is closed.' : 'Local terminal is disabled.' }, 403);
      }
      return json(await manager.execute(input, { invocationId: randomUUID(), abortSignal: request.signal }));
    } catch (error) { return json({ error: error instanceof Error ? error.message : 'Terminal operation failed.' }, 400); }
  }
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  if (new URL(request.url).searchParams.get('stream') !== '1') return json({ terminals: await manager.list(), enabled: options.enabled });
  let release = () => {};
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
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
      try {
        const snapshot = { type: 'snapshot', enabled: options.enabled, terminals: await Promise.all((await manager.list()).map(terminal => manager.read(terminal.terminalId, 0, true))) };
        send(snapshot);
        if (request.signal.aborted) finish();
      } catch (error) { release(); controller.error(error); }
    },
    cancel() { release(); },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-store, no-transform', 'X-Accel-Buffering': 'no' } });
}

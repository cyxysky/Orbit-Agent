import type { TerminalEvent, TerminalResult, TerminalToolInput } from './index.ts';
export type TerminalClientEvent = TerminalEvent | { type: 'snapshot'; terminals: TerminalResult[]; enabled: boolean } | { type: 'heartbeat' };
export type TerminalConnection = { status: 'connecting' | 'connected' | 'reconnecting' | 'error'; error?: string };
export interface TerminalClient {
  execute(input: TerminalToolInput): Promise<TerminalResult>;
  subscribe(onEvent: (event: TerminalClientEvent) => void, onConnection: (connection: TerminalConnection) => void): () => void;
}
const errorMessage = (data: { error?: string | { message?: string } }, fallback: string) =>
  typeof data.error === 'string' ? data.error : data.error?.message || fallback;
export function createHttpTerminalClient(url: string): TerminalClient {
  type Write = Extract<TerminalToolInput, { action: 'write' }>;
  type Resize = Extract<TerminalToolInput, { action: 'resize' }>;
  type Entry = { request: Write; resolve: (result: TerminalResult) => void; reject: (error: unknown) => void };
  type Queue = { entries: Entry[]; chars: number; timer?: ReturnType<typeof setTimeout>; active?: Promise<void> };
  type ResizeEntry = Omit<Entry, 'request'> & { request: Resize };
  type ResizeQueue = { entries: ResizeEntry[]; active?: Promise<void> };
  const inputs = new Map<string, Queue>();
  const resizes = new Map<string, ResizeQueue>();
  const post = async (input: TerminalToolInput): Promise<TerminalResult> => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      ...(input.action === 'write' || input.action === 'resize' ? { signal: AbortSignal.timeout(10000) } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(errorMessage(data, 'Terminal operation failed.'));
    return data;
  };
  const discard = (queue: Queue, error: unknown) => {
    clearTimeout(queue.timer); queue.timer = undefined; queue.chars = 0;
    for (const entry of queue.entries.splice(0)) entry.reject(error);
  };
  const flush = (id: string, queue: Queue) => {
    clearTimeout(queue.timer); queue.timer = undefined;
    if (queue.active) return;
    queue.active = (async () => {
      while (queue.entries.length) {
        // Combine keys received during one round trip into the next request.
        // Keep each paste intact, respect the tool's input limit, and preserve
        // order independently for each terminal instead of blocking all tabs.
        const batch: Entry[] = []; let chars = 0;
        while (queue.entries.length && chars + queue.entries[0].request.input.length <= 100000) {
          const entry = queue.entries.shift()!; batch.push(entry); chars += entry.request.input.length;
        }
        queue.chars -= chars;
        try {
          const data = await post({ ...batch[0].request, input: batch.map(entry => entry.request.input).join('') });
          for (const entry of batch) entry.resolve(data);
        } catch (error) {
          // An unacknowledged write may already have reached the shell. Never
          // replay it, or send its queued tail after the connection fails.
          for (const entry of batch) entry.reject(error);
          discard(queue, error);
        }
      }
    })().finally(() => {
      queue.active = undefined;
      if (queue.entries.length) flush(id, queue);
      else if (inputs.get(id) === queue) inputs.delete(id);
    });
  };
  const flushResize = (id: string, queue: ResizeQueue) => {
    if (queue.active) return;
    queue.active = (async () => {
      while (queue.entries.length) {
        // Only the latest pending geometry matters; never let older requests
        // finish after a newer resize and leave the PTY at the wrong size.
        const batch = queue.entries.splice(0);
        try {
          const result = await post(batch[batch.length - 1].request);
          for (const entry of batch) entry.resolve(result);
        } catch (error) {
          for (const entry of batch) entry.reject(error);
        }
      }
    })().finally(() => {
      queue.active = undefined;
      if (queue.entries.length) flushResize(id, queue);
      else if (resizes.get(id) === queue) resizes.delete(id);
    });
  };
  return {
    async execute(input) {
      if (input.action === 'resize') {
        const queue = resizes.get(input.terminalId) || { entries: [] };
        resizes.set(input.terminalId, queue);
        return new Promise<TerminalResult>((resolve, reject) => {
          queue.entries.push({ request: input, resolve, reject });
          flushResize(input.terminalId, queue);
        });
      }
      if (input.action === 'write') {
        if (!input.input.length || input.input.length > 100000) throw new Error('Terminal input must contain between 1 and 100000 characters.');
        const queue = inputs.get(input.terminalId) || { entries: [], chars: 0 };
        if (queue.chars + input.input.length > 200000 || queue.entries.length >= 2048) throw new Error('Terminal input is arriving faster than it can be sent.');
        inputs.set(input.terminalId, queue);
        return new Promise<TerminalResult>((resolve, reject) => {
          queue.entries.push({ request: input, resolve, reject }); queue.chars += input.input.length;
          if (!queue.active && !queue.timer) queue.timer = setTimeout(() => flush(input.terminalId, queue), 8);
        });
      }
      if (input.action === 'interrupt' || input.action === 'close' || input.action === 'delete') {
        const queue = inputs.get(input.terminalId);
        if (queue) {
          discard(queue, new DOMException('Pending terminal input was cancelled.', 'AbortError'));
          if (queue.active) await queue.active;
          else inputs.delete(input.terminalId);
        }
      }
      if (input.action === 'close' || input.action === 'delete') {
        const queue = resizes.get(input.terminalId);
        if (queue) {
          const error = new DOMException('Pending terminal resize was cancelled.', 'AbortError');
          for (const entry of queue.entries.splice(0)) entry.reject(error);
          if (queue.active) await queue.active;
        }
      }
      return post(input);
    },
    subscribe(onEvent, onConnection) {
      let stopped = false, attempt = 0;
      let connection: TerminalConnection | undefined;
      const updateConnection = (next: TerminalConnection) => {
        if (connection?.status === next.status && connection?.error === next.error) return;
        connection = next; onConnection(next);
      };
      let retry: ReturnType<typeof setTimeout> | undefined;
      let active: AbortController | undefined;
      const connect = async () => {
        const controller = new AbortController(); active = controller;
        let deadline: ReturnType<typeof setTimeout> | undefined;
        const armDeadline = (ms: number) => {
          clearTimeout(deadline);
          deadline = setTimeout(() => controller.abort(new Error('终端连接超时，请重试。')), ms);
        };
        let retryable = true;
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        updateConnection({ status: attempt ? 'reconnecting' : 'connecting' });
        armDeadline(15000);
        try {
          const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}stream=1`, {
            signal: controller.signal, cache: 'no-store', headers: { Accept: 'text/event-stream' },
          });
          if (!response.ok) {
            retryable = response.status >= 500 || [408, 429].includes(response.status);
            const data = await response.json().catch(() => ({}));
            throw new Error(errorMessage(data, `终端连接失败（HTTP ${response.status}）`));
          }
          if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
            retryable = false;
            throw new Error('终端接口未返回实时数据流，请检查连接。');
          }
          reader = response.body.getReader();
          const decoder = new TextDecoder(); let buffer = '';
          while (!stopped) {
            const { value, done } = await reader.read();
            if (done) throw new Error('终端连接已断开，正在重新连接。');
            armDeadline(45000);
            buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
            let boundary: number;
            while ((boundary = buffer.indexOf('\n\n')) >= 0) {
              const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
              const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
              if (data) {
                const event = JSON.parse(data) as TerminalClientEvent;
                if (stopped) return;
                attempt = 0; updateConnection({ status: 'connected' }); onEvent(event);
                if (event.type === 'reset') return;
              }
            }
          }
        } catch (reason) {
          if (stopped) return;
          const failure = controller.signal.aborted ? controller.signal.reason : reason;
          const error = failure instanceof Error ? failure.message : String(failure);
          updateConnection({ status: retryable ? 'reconnecting' : 'error', error });
          if (retryable) retry = setTimeout(() => { void connect(); }, Math.min(10000, 1000 * 2 ** attempt++));
        } finally {
          clearTimeout(deadline); await reader?.cancel().catch(() => undefined); reader?.releaseLock();
        }
      };
      void connect();
      return () => { stopped = true; clearTimeout(retry); active?.abort(); };
    },
  };
}

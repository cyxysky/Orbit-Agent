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
  return {
    async execute(input) {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const data = await response.json();
      if (!response.ok) throw new Error(errorMessage(data, 'Terminal operation failed.'));
      return data;
    },
    subscribe(onEvent, onConnection) {
      let stopped = false, attempt = 0;
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
        onConnection({ status: attempt ? 'reconnecting' : 'connecting' });
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
                attempt = 0; onConnection({ status: 'connected' }); onEvent(event);
                if (event.type === 'reset') return;
              }
            }
          }
        } catch (reason) {
          if (stopped) return;
          const failure = controller.signal.aborted ? controller.signal.reason : reason;
          const error = failure instanceof Error ? failure.message : String(failure);
          onConnection({ status: retryable ? 'reconnecting' : 'error', error });
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

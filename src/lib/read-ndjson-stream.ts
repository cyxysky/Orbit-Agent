/** Read bounded newline-delimited updates, including a final unterminated line. */
export async function readNdjsonStream<T>(response: Response, onValue: (value: T) => void, signal?: AbortSignal) {
  if (!response.body) throw new Error('Streaming response has no body.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const abort = () => { void reader.cancel(signal?.reason).catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  let pending = '';
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      pending += decoder.decode(value, { stream: !done });
      if (pending.length > 1024 * 1024) throw new Error('Streaming update exceeds its size limit.');
      const lines = pending.split('\n'); pending = lines.pop() || '';
      for (const line of lines) if (line.trim()) onValue(JSON.parse(line) as T);
      if (done) { if (pending.trim()) onValue(JSON.parse(pending) as T); return; }
    }
  } finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

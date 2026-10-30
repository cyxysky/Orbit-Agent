// Preserve the AI SDK HTTP response contract while carrying its stream over an
// upgraded socket. No automatic retry: a lost connection may follow execution.
export const browserChatStreamFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin !== window.location.origin || request.method !== 'POST') {
    throw new Error('Chat streaming requires a same-origin POST');
  }
  const body = await request.text();
  request.signal.throwIfAborted();
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return new Promise<Response>((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let receivedHeaders = false;
    let finished = false;
    const cleanup = () => { clearTimeout(timeout); request.signal.removeEventListener('abort', abort); };
    const fail = (error: unknown) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (receivedHeaders) controller?.error(error); else reject(error);
      socket.close();
    };
    const abort = () => fail(request.signal.reason || new DOMException('Aborted', 'AbortError'));
    const timeout = setTimeout(() => fail(new Error('对话连接初始化超时，请刷新会话查看任务状态。')), 60_000);
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) { abort(); return; }
    socket.onopen = () => { if (!finished) socket.send(body); };
    socket.onerror = () => fail(new Error('对话连接失败，请检查 WebSocket 连接并刷新会话。'));
    socket.onclose = () => {
      if (!finished) fail(new Error('对话连接已断开，任务可能仍在后台运行，请刷新查看，勿重复提交。'));
    };
    socket.onmessage = event => {
      if (finished) return;
      try {
        if (event.data instanceof ArrayBuffer) {
          if (!controller) throw new Error('Missing chat response headers');
          controller.enqueue(new Uint8Array(event.data));
          if ((controller.desiredSize || 0) < -4 * 1024 * 1024) throw new Error('Chat consumer is too slow; refresh to load persisted results');
          return;
        }
        const message = JSON.parse(event.data);
        if (message.type === 'response' && !receivedHeaders) {
          clearTimeout(timeout);
          const stream = new ReadableStream<Uint8Array>({
            start(value) { controller = value; },
            cancel() { finished = true; cleanup(); socket.close(); },
          }, { highWaterMark: 1024 * 1024, size: chunk => chunk.byteLength });
          const response = new Response(stream, { status: message.status, headers: message.headers });
          receivedHeaders = true;
          resolve(response);
        } else if (message.type === 'end' && receivedHeaders) {
          finished = true;
          cleanup();
          controller?.close();
          socket.close();
        } else throw new Error(message.type === 'error'
          ? '对话传输中断，任务可能仍在后台运行，请刷新查看，勿重复提交。' : 'Invalid chat stream response');
      } catch (error) { fail(error); }
    };
  });
};

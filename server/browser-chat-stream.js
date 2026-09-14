/* eslint-disable @typescript-eslint/no-require-imports */
const http = require('node:http');
const { WebSocketServer, WebSocket } = require('ws');

function browserChatStreamPath(pathname) {
  return /^\/api\/browser-chat\/[a-zA-Z0-9_-]+\/message$/.test(pathname);
}

function sameOriginUpgrade(request) {
  try {
    const origin = new URL(request.headers.origin);
    if (!['http:', 'https:'].includes(origin.protocol)) return false;
    // Browser fetch metadata remains authoritative behind a proxy that rewrites
    // Host. Without it, require an exact public origin host match.
    return request.headers['sec-fetch-site'] === 'same-origin'
      || origin.host === new URL(`http://${request.headers.host}`).host;
  } catch { return false; }
}

// One WebSocket carries one existing HTTP message response. Keeping the bytes
// unchanged lets AI SDK retain its stream parser, metadata and tool semantics.
// Upgraded connections do not occupy the browser's six HTTP/1.1 request slots.
function createBrowserChatStreamHub({ getRuntime, authenticateRequest }) {
  const server = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024, perMessageDeflate: false });
  const heartbeat = setInterval(() => {
    for (const socket of server.clients) {
      if (socket.alive === false) { socket.terminate(); continue; }
      socket.alive = false;
      socket.ping();
    }
  }, 25_000);
  heartbeat.unref();

  return {
    acceptUpgrade(request, socket, head) {
      if (!sameOriginUpgrade(request) || !authenticateRequest(request)) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        return;
      }
      server.handleUpgrade(request, socket, head, websocket => {
        websocket.alive = true;
        websocket.on('pong', () => { websocket.alive = true; });
        let submitted = false;
        let upstream;
        const deadline = setTimeout(() => websocket.close(1008, 'Message body required'), 10_000);
        const cleanup = () => { clearTimeout(deadline); upstream?.destroy(); };
        websocket.once('close', cleanup);
        websocket.once('error', cleanup);
        const fail = () => {
          if (websocket.readyState !== WebSocket.OPEN) return;
          websocket.send(JSON.stringify({ type: 'error', message: 'Chat transport disconnected. The task may still be running; refresh its state before sending again.' }), () => websocket.close(1011));
        };
        websocket.on('message', (body, binary) => {
          if (submitted || binary) { websocket.close(1008, 'One JSON message per connection'); return; }
          submitted = true;
          clearTimeout(deadline);
          void (async () => {
            const runtime = await getRuntime();
            if (websocket.readyState !== WebSocket.OPEN) return;
            const headers = {
              host: request.headers.host,
              origin: request.headers.origin,
              'content-type': 'application/json',
              'content-length': body.length,
              'x-webpilot-backend-token': process.env.WEBPILOT_INTERNAL_REQUEST_TOKEN,
            };
            for (const name of ['cookie', 'x-webpilot-identity-user-id', 'x-webpilot-identity-username', 'x-webpilot-identity-roles', 'x-webpilot-identity-proof']) {
              if (request.headers[name]) headers[name] = request.headers[name];
            }
            upstream = http.request({ hostname: runtime.hostname, port: runtime.port, path: request.url, method: 'POST', headers });
            upstream.once('response', response => {
              upstream.setTimeout(0);
              if (websocket.readyState !== WebSocket.OPEN) { response.destroy(); return; }
              const headers = {};
              for (const name of ['content-type', 'cache-control', 'x-vercel-ai-ui-message-stream', 'x-request-id']) {
                if (response.headers[name]) headers[name] = response.headers[name];
              }
              websocket.send(JSON.stringify({ type: 'response', status: response.statusCode || 502, headers }));
              response.on('data', chunk => {
                response.pause();
                if (websocket.readyState !== WebSocket.OPEN) { response.destroy(); return; }
                websocket.send(chunk, { binary: true }, error => {
                  if (error) { response.destroy(); fail(); }
                  else response.resume();
                });
              });
              response.once('end', () => {
                if (websocket.readyState === WebSocket.OPEN) websocket.send(JSON.stringify({ type: 'end' }), () => websocket.close(1000));
              });
              response.once('error', fail);
            });
            // This only bounds response initialization, never a running stream.
            upstream.setTimeout(60_000, () => upstream.destroy(new Error('Chat response startup timed out')));
            upstream.once('error', fail);
            upstream.end(body);
          })().catch(fail);
        });
      });
    },
    close() {
      clearInterval(heartbeat);
      for (const socket of server.clients) socket.terminate();
      server.close();
    },
  };
}

module.exports = { browserChatStreamPath, createBrowserChatStreamHub, sameOriginUpgrade };

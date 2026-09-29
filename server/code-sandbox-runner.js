/* eslint-disable no-console */
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { existsSync } = require('node:fs');
const executionRuntime = existsSync(path.join(__dirname, 'capability-runtime', 'execution', 'files.cjs'))
  ? path.join(__dirname, 'capability-runtime', 'execution')
  : existsSync(path.join(__dirname, '..', 'capability-runtime', 'execution', 'files.cjs'))
    ? path.join(__dirname, '..', 'capability-runtime', 'execution')
    : path.join(__dirname, '..', 'packages', 'capability-sdk', 'runtime', 'execution');
const { createCodeExecutionEngine } = require(path.join(executionRuntime, 'engine.cjs'));

const HOST = process.env.CODE_SANDBOX_RUNNER_HOST || '127.0.0.1';
const PORT = Number(process.env.CODE_SANDBOX_RUNNER_PORT || 18100);
const TOKEN = String(process.env.CODE_SANDBOX_RUNNER_TOKEN || '').trim();
const WORKSPACE_ROOT = path.resolve(process.env.CODE_SANDBOX_RUNNER_WORKSPACE || path.join(os.tmpdir(), 'webpilot-code-sandbox'));
// The Windows development runner reuses wheel downloads across disposable jobs.
// Container runners do not retain a cross-job pip cache.
const PIP_CACHE_DIRECTORY = process.platform === 'win32' ? path.join(WORKSPACE_ROOT, 'pip-cache') : '';
const MAX_BODY_BYTES = 46 * 1024 * 1024;
const MAX_CONCURRENCY = Math.max(1, Math.min(16, Math.floor(Number(process.env.CODE_SANDBOX_RUNNER_CONCURRENCY) || 2)));
const engine = createCodeExecutionEngine({
  workspaceDirectory: WORKSPACE_ROOT,
  maxConcurrent: MAX_CONCURRENCY,
  pythonExecutable: process.env.CODE_SANDBOX_PYTHON_PATH,
  npmCli: [process.env.CODE_SANDBOX_NPM_CLI, path.join(executionRuntime, 'npm', 'bin', 'npm-cli.js')].find(value => value && existsSync(value)),
  pipCacheDirectory: PIP_CACHE_DIRECTORY,
  dropPrivileges: true,
});
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  server.closeAllConnections();
  const deadline = setTimeout(() => process.exit(0), 5000);
  deadline.unref();
  await engine.dispose();
  process.exit(0);
}
if (process.connected) process.once('disconnect', shutdown);
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
process.on('message', message => { if (message?.type === 'shutdown') void shutdown(); });

function authorized(request) {
  if (!TOKEN) return false;
  return request.headers.authorization === `Bearer ${TOKEN}`;
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.once('error', reject);
  });
}

const server = http.createServer(async (request, response) => {
  if (!authorized(request)) {
    sendJson(response, 401, { error: 'Unauthorized.' });
    return;
  }
  if (request.method === 'GET' && (request.url === '/health' || request.url === '/healthz')) {
    sendJson(response, 200, { status: 'healthy', network: 'full', concurrency: MAX_CONCURRENCY });
    return;
  }
  if (request.method !== 'POST' || request.url !== '/v1/execute') {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }
  const abortController = new AbortController();
  request.once('aborted', () => abortController.abort(new Error('Client disconnected.')));
  response.once('close', () => { if (!response.writableEnded) abortController.abort(new Error('Client disconnected.')); });
  try {
    const raw = await readBody(request);
    const payload = JSON.parse(raw);

    const result = await engine.run(payload, abortController.signal);
    sendJson(response, 200, result);
  } catch (error) {
    if (!response.destroyed) sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

if (!TOKEN) {
  console.error('CODE_SANDBOX_RUNNER_TOKEN must be set.');
  process.exit(1);
}

server.requestTimeout = 0;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.listen(PORT, HOST, () => console.log(`Code Sandbox runner listening on ${HOST}:${server.address().port} (network=full, concurrency=${MAX_CONCURRENCY})`));

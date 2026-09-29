/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

function managedRunnerUrl(environment) {
  if (environment.AGENT_CODE_SANDBOX_ENABLED !== 'true'
    || (environment.AGENT_CODE_SANDBOX_BACKEND || 'remote') !== 'remote') return undefined;
  let url;
  try { url = new URL(environment.AGENT_CODE_SANDBOX_RUNNER_URL || 'http://127.0.0.1:18100'); }
  catch { return undefined; }
  // Remote/container runners retain their own lifecycle and isolation policy.
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return undefined;
  if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    return undefined;
  }
  if (environment.AGENT_CODE_SANDBOX_NETWORK_MODE === 'none') {
    return undefined;
  }
  return url;
}

async function startManagedRunner({ appDir, environment, url }) {
  const token = String(environment.AGENT_CODE_SANDBOX_RUNNER_TOKEN || '').trim();
  if (!token) throw new Error('请先配置 AGENT_CODE_SANDBOX_RUNNER_TOKEN，再启动本机代码沙箱 Runner。');

  const healthy = async () => {
    let response;
    try {
      response = await fetch(new URL('/health', url), {
        headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1_000),
      });
    } catch (error) {
      const causes = error.cause?.errors || [error.cause];
      if (causes.length && causes.every((cause) => cause?.code === 'ECONNREFUSED')) return false;
      throw new Error(`无法检查本机代码沙箱 Runner ${url.origin}，请检查地址和端口。`, { cause: error });
    }
    if (!response.ok || (await response.json()).status !== 'healthy') {
      throw new Error(`本机 Runner ${url.origin} 健康检查失败（HTTP ${response.status}），请检查端口占用和 Runner Token。`);
    }
    return true;
  };
  if (await healthy()) {
    console.log(`[code-sandbox] Reusing Runner at ${url.origin}`);
    return { healthy, stop: async () => {}, running: () => true };
  }

  const child = spawn(process.execPath, [path.join(__dirname, 'code-sandbox-runner.js')], {
    cwd: appDir,
    env: {
      ...environment,
      CODE_SANDBOX_RUNNER_HOST: url.hostname === '[::1]' ? '::1' : url.hostname,
      CODE_SANDBOX_RUNNER_PORT: url.port || '80',
      CODE_SANDBOX_RUNNER_TOKEN: token,
      CODE_SANDBOX_RUNNER_CONCURRENCY: environment.AGENT_CODE_SANDBOX_MAX_CONCURRENCY || '2',
      CODE_SANDBOX_PYTHON_PATH: environment.CODE_SANDBOX_PYTHON_PATH || environment.GLINER_PYTHON_PATH || '',
    },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    windowsHide: true,
  });
  let failure;
  let stopped = false;
  const forceStop = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  };
  let stopping;
  const stop = () => stopping ||= new Promise((resolve) => {
    stopped = true;
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) { resolve(); return; }
    const timer = setTimeout(() => { forceStop(); resolve(); }, 3_000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    if (child.connected) child.send({ type: 'shutdown' }, () => undefined);
    else forceStop();
  });
  child.once('error', (error) => { failure = error; });
  child.once('exit', (code, signal) => {
    failure ||= new Error(`Runner exited (${signal || code}).`);
    if (!stopped) console.error('[code-sandbox] 本机 Runner 已退出；请检查启动日志。');
  });
  // IPC disconnect lets the Runner stop its jobs when the host exits or crashes.
  // The Runner must not keep a failed/stopped host alive.
  child.unref();
  child.channel?.unref();
  try {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      if (await healthy()) {
        console.log(`[code-sandbox] Managed Runner ready at ${url.origin}`);
        return { stop, healthy, running: () => !failure && !stopped };
      }
      await delay(100);
    }
    throw new Error('本机代码沙箱 Runner 启动超时，请检查启动日志。');
  } catch (error) {
    await stop();
    throw error;
  }
}

function createCodeSandboxRunnerManager({ appDir }) {
  let runner, key, latestEnvironment, closed = false, lastCheck = 0, retryAfter = 0;
  let queue = Promise.resolve();
  const sync = (environment = process.env) => {
    const snapshot = { ...environment };
    latestEnvironment = snapshot;
    const operation = queue.then(async () => {
      if (closed) return;
      const url = managedRunnerUrl(snapshot);
      const nextKey = JSON.stringify([url?.href, snapshot.AGENT_CODE_SANDBOX_RUNNER_TOKEN,
        snapshot.AGENT_CODE_SANDBOX_MAX_CONCURRENCY, snapshot.CODE_SANDBOX_PYTHON_PATH, snapshot.GLINER_PYTHON_PATH]);
      if (nextKey !== key) {
        await runner?.stop(); runner = undefined; key = nextKey; retryAfter = 0;
      }
      if (!url || Date.now() < retryAfter) return;
      try {
        if (runner?.running() && Date.now() - lastCheck < 5_000) return;
        if (runner?.running() && await runner.healthy()) { lastCheck = Date.now(); return; }
        await runner?.stop(); runner = undefined;
        runner = await startManagedRunner({ appDir, environment: snapshot, url });
        lastCheck = Date.now();
      } catch (error) { retryAfter = Date.now() + 5_000; throw error; }
    });
    queue = operation.catch(() => undefined);
    return operation;
  };
  const monitor = setInterval(() => {
    if (!closed && latestEnvironment) void sync(latestEnvironment).catch(error => console.error('[code-sandbox] Runner recovery failed', error));
  }, 5_000);
  monitor.unref();
  return {
    sync, managedRunnerUrl,
    async close() { closed = true; clearInterval(monitor); await queue; await runner?.stop(); runner = undefined; },
  };
}

module.exports = { createCodeSandboxRunnerManager };

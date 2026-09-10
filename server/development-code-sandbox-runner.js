/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

async function startDevelopmentCodeSandboxRunner({ appDir, environment = process.env }) {
  if (environment.AGENT_CODE_SANDBOX_ENABLED !== 'true'
    || (environment.AGENT_CODE_SANDBOX_BACKEND || 'remote') !== 'remote') return undefined;
  const url = new URL(environment.AGENT_CODE_SANDBOX_RUNNER_URL || 'http://webpilot-code-sandbox:18100');
  // Remote/container runners retain their own lifecycle and isolation policy.
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return undefined;
  if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('本机代码沙箱 Runner 需要根路径 HTTP 地址，例如 http://127.0.0.1:18100。');
  }
  if (environment.AGENT_CODE_SANDBOX_NETWORK_MODE === 'none') {
    console.warn('[code-sandbox] 禁止网络模式需要独立隔离的 Runner，开发服务不会启动允许联网的本机 Runner。');
    return undefined;
  }
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
      if (causes.some((cause) => cause?.code === 'ECONNREFUSED')) return false;
      throw new Error(`无法检查本机代码沙箱 Runner ${url.origin}，请检查地址和端口。`, { cause: error });
    }
    if (!response.ok || (await response.json()).status !== 'healthy') {
      throw new Error(`本机 Runner ${url.origin} 健康检查失败（HTTP ${response.status}），请检查端口占用和 Runner Token。`);
    }
    return true;
  };
  if (await healthy()) {
    console.log(`[code-sandbox] Reusing Runner at ${url.origin}`);
    return undefined;
  }

  const child = spawn(process.execPath, [path.join(__dirname, 'code-sandbox-runner.js')], {
    cwd: appDir,
    env: {
      ...environment,
      CODE_SANDBOX_RUNNER_HOST: url.hostname === '[::1]' ? '::1' : url.hostname,
      CODE_SANDBOX_RUNNER_PORT: url.port || '80',
      CODE_SANDBOX_RUNNER_TOKEN: token,
      CODE_SANDBOX_RUNNER_CONCURRENCY: environment.AGENT_CODE_SANDBOX_MAX_CONCURRENCY || '2',
    },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    windowsHide: true,
  });
  let failure;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    process.removeListener('exit', stop);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  };
  child.once('error', (error) => { failure = error; });
  child.once('exit', (code, signal) => {
    process.removeListener('exit', stop);
    failure ||= new Error(`Runner exited (${signal || code}).`);
    if (!stopped) console.error('[code-sandbox] 本机 Runner 已退出；请检查启动日志。');
  });
  process.once('exit', stop);
  // The Runner must not keep a failed/stopped development server alive.
  child.unref();
  child.channel?.unref();
  try {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (failure) throw failure;
      if (await healthy()) {
        console.log(`[code-sandbox] Development Runner ready at ${url.origin}`);
        return { stop };
      }
      await delay(100);
    }
    throw new Error('本机代码沙箱 Runner 启动超时，请检查启动日志。');
  } catch (error) {
    stop();
    throw error;
  }
}

module.exports = { startDevelopmentCodeSandboxRunner };

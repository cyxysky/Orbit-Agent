/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('node:path');
const { loadEnvConfig } = require('@next/env');

// A standalone runner has its own lifecycle; starting Orbit does not start it.
// Reuse the application's local connection settings without printing secrets.
loadEnvConfig(path.resolve(__dirname, '..'), true);
const runnerUrl = new URL(process.env.AGENT_CODE_SANDBOX_RUNNER_URL || 'http://127.0.0.1:18100');
if (runnerUrl.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(runnerUrl.hostname)
  || runnerUrl.username || runnerUrl.password || runnerUrl.search || runnerUrl.hash || runnerUrl.pathname !== '/') {
  throw new Error('本机 Runner 启动命令要求 AGENT_CODE_SANDBOX_RUNNER_URL 为本机 HTTP 地址，例如 http://127.0.0.1:18100。远程 Runner 请在其部署环境启动。');
}
process.env.CODE_SANDBOX_RUNNER_HOST = runnerUrl.hostname === '[::1]' ? '::1' : runnerUrl.hostname;
process.env.CODE_SANDBOX_RUNNER_PORT = runnerUrl.port || '80';
process.env.CODE_SANDBOX_RUNNER_TOKEN = process.env.AGENT_CODE_SANDBOX_RUNNER_TOKEN || process.env.CODE_SANDBOX_RUNNER_TOKEN || '';
process.env.CODE_SANDBOX_RUNNER_CONCURRENCY ||= process.env.AGENT_CODE_SANDBOX_MAX_CONCURRENCY || '2';
require('./code-sandbox-runner');

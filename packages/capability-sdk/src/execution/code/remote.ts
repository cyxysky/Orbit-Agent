import { CodeSandboxRunnerError, createCodeSandboxCapability, type CodeSandboxExecutor, type CodeSandboxExecution, type CodeSandboxExecutionResult } from './index.ts';
import type { CapabilityRunContext } from '../../index.ts';

type RemoteResult = CodeSandboxExecutionResult & { error?: string };

function runnerUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Code Sandbox runner URL must use HTTP or HTTPS.');
  return url.href.replace(/\/$/, '');
}

async function readJson(response: Response) {
  const text = await response.text();
  try { return JSON.parse(text) as unknown; } catch { throw new Error(text.slice(0, 2_000) || `Runner returned HTTP ${response.status}.`); }
}

function connectionError(error: unknown, baseUrl: string, healthCheck = false) {
  const seen = new Set<object>();
  const codes = (value: unknown): string[] => {
    if (!value || typeof value !== 'object' || seen.has(value)) return ['UNKNOWN'];
    seen.add(value);
    const entry = value as { code?: unknown; cause?: unknown; errors?: unknown[] };
    // Aggregate failures must all be pre-dispatch before declaring non-execution.
    if (Array.isArray(entry.errors) && entry.errors.length) return entry.errors.flatMap(codes);
    if (entry.cause) return codes(entry.cause);
    return [typeof entry.code === 'string' ? entry.code : 'UNKNOWN'];
  };
  const causes = codes(error);
  const detailCodes = [...new Set(causes)].filter(code => /^[A-Z][A-Z0-9_]+$/.test(code) && code !== 'UNKNOWN');
  const detail = detailCodes.length ? ` (${detailCodes.join(', ')})` : '';
  const notDispatched = causes.length > 0 && causes.every(code => ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT'].includes(code));
  const guidance = causes.some(code => code === 'ENOTFOUND' || code === 'EAI_AGAIN')
    ? 'Runner 主机名解析失败。请使用主服务所在环境可访问的地址；Docker 服务名仅适用于同一容器网络，本机 Runner 通常使用 http://127.0.0.1:18100。'
    : '请检查 Runner 服务是否启动，以及主服务到 Runner 的地址、端口和网络。';
  const execution = healthCheck ? '健康检查未提交代码执行请求。'
    : notDispatched ? '本次请求未送达 Runner，代码未通过本次请求执行。修复连接后可重新提交，请勿在配置未变时反复重试。'
      : '连接中断，无法确认远端代码是否已执行；请先核实任务状态，勿自动重复提交。';
  return new CodeSandboxRunnerError('code-sandbox-runner-unavailable',
    `无法连接代码沙箱 Runner ${new URL(baseUrl).origin}${detail}。${guidance}${execution}`,
    { cause: error });
}

export function createHttpCodeSandboxExecutor(input: {
  url: string;
  token?: string;
}): CodeSandboxExecutor {
  const baseUrl = runnerUrl(input.url);
  const headers = {
    'content-type': 'application/json',
    ...(input.token?.trim() ? { authorization: `Bearer ${input.token.trim()}` } : {}),
  };
  return {
    async run(execution: CodeSandboxExecution, context): Promise<CodeSandboxExecutionResult> {
      const responseTimeoutMs = execution.timeoutMs + (execution.packages.length ? execution.installTimeoutMs : 0) + 10_000;
      const signal = context.abortSignal ? AbortSignal.any([context.abortSignal, AbortSignal.timeout(responseTimeoutMs)]) : AbortSignal.timeout(responseTimeoutMs);
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/v1/execute`, {
          method: 'POST', headers, redirect: 'error',
          body: JSON.stringify({ ...execution, invocationId: context.invocationId }), signal,
        });
      } catch (error) {
        if (context.abortSignal?.aborted) throw context.abortSignal.reason;
        if (signal.aborted) throw new CodeSandboxRunnerError('code-sandbox-runner-timeout', '等待代码沙箱 Runner 响应超时，远端任务状态未知，请勿自动重试。', { cause: error });
        throw connectionError(error, baseUrl);
      }
      const payload = await readJson(response) as RemoteResult;
      if (!response.ok || payload.error) throw new Error(payload.error || `Runner returned HTTP ${response.status}.`);
      return payload;
    },
    async health() {
      try {
        const response = await fetch(`${baseUrl}/health`, { headers: input.token?.trim() ? { authorization: `Bearer ${input.token.trim()}` } : {}, signal: AbortSignal.timeout(3_000) });
        const payload = await readJson(response) as { status?: string; message?: string };
        if (!response.ok) return { status: 'unhealthy', message: payload.message || `Runner returned HTTP ${response.status}.` };
        return payload.status === 'healthy' ? { status: 'healthy' } : { status: 'needs-runtime', message: payload.message || 'Code Sandbox runner is not ready.' };
      } catch (error) {
        return { status: 'needs-runtime', message: connectionError(error, baseUrl, true).message };
      }
    },
  };
}

export function createHttpCodeSandboxCapability(input: {
  url: string | ((context: CapabilityRunContext) => string);
  token?: string | ((context: CapabilityRunContext) => string | undefined);
}) {
  return createCodeSandboxCapability({
    createExecutor(context) {
      const url = typeof input.url === 'function' ? input.url(context) : input.url;
      const token = typeof input.token === 'function' ? input.token(context) : input.token;
      return createHttpCodeSandboxExecutor({ url, token });
    },
  });
}

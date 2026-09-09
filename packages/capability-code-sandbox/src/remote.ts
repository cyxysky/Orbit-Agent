import { CodeSandboxRunnerError, createCodeSandboxCapability, type CodeSandboxExecutor, type CodeSandboxExecution, type CodeSandboxExecutionResult } from './index.ts';
import type { CapabilityRunContext } from '@webpilot/capability-sdk';

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

function connectionError(error: unknown, baseUrl: string) {
  const cause = error instanceof Error ? error.cause as { code?: unknown; errors?: Array<{ code?: unknown }> } | undefined : undefined;
  const code = cause?.code || cause?.errors?.[0]?.code;
  const detail = typeof code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(code) ? ` (${code})` : '';
  return new CodeSandboxRunnerError('code-sandbox-runner-unavailable',
    `无法连接代码沙箱 Runner ${new URL(baseUrl).origin}${detail}。请检查 Runner 服务是否启动，以及设置中的 Runner 地址和端口。此错误发生在连接阶段，无法确认代码是否已执行，请勿自动重试。`,
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
      const signal = context.abortSignal ? AbortSignal.any([context.abortSignal, AbortSignal.timeout(execution.timeoutMs + 10_000)]) : AbortSignal.timeout(execution.timeoutMs + 10_000);
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/v1/execute`, {
          method: 'POST', headers,
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
        return { status: 'needs-runtime', message: connectionError(error, baseUrl).message };
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

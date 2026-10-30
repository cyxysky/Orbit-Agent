export function apiErrorMessage(data: unknown, fallback: string) {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const error = (data as Record<string, unknown>).error;
    if (typeof error === 'string' && error.trim()) return error;
    const message = (data as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

export async function readApiJson<T = Record<string, unknown>>(response: Response, fallback: string): Promise<T> {
  const data = await response.json().catch(() => {
    if (response.ok) throw new Error(`${fallback}：服务器返回了无效的 JSON`);
    return {};
  });
  if (!response.ok) throw new Error(apiErrorMessage(data, fallback));
  return data as T;
}

/** Bound both the response headers and body of read-only data requests. */
export async function readApiGet<T = Record<string, unknown>>(
  url: string,
  fallback: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  try {
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    const response = await fetch(url, { cache: 'no-store', signal });
    return await readApiJson<T>(response, fallback);
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) throw new Error(`${fallback}：请求超时，请重试`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

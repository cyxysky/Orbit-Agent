import { getErrorCode, ERROR_CODES } from '@cjfclonedeep/capability-sdk';

/** Preserve exception evidence before JSON serialization drops Error properties. */
export function codexRuntimeError(error: unknown, depth = 0): Record<string, unknown> {
  if (depth > 5) return { code: ERROR_CODES.AI_RUNTIME_FAILED, message: '[Nested error]' };
  if (!error || typeof error !== 'object') return { code: ERROR_CODES.AI_RUNTIME_FAILED, message: String(error) };
  const value = error as Record<string, unknown>;
  return {
    name: error instanceof Error ? error.name : value.name,
    message: error instanceof Error ? error.message : value.message,
    stack: error instanceof Error ? error.stack : value.stack,
    code: getErrorCode(error, ERROR_CODES.AI_RUNTIME_FAILED),
    ...(value.code !== undefined && value.code !== getErrorCode(error, ERROR_CODES.AI_RUNTIME_FAILED) ? { upstreamCode: value.code } : {}),
    ...Object.fromEntries(['rpcCode', 'statusCode', 'responseBody', 'data', 'codexErrorInfo', 'additionalDetails', 'retryable', 'reviewAttempts', 'timeoutMs']
      .filter(key => value[key] !== undefined).map(key => [key, value[key]])),
    ...(value.cause !== undefined ? { cause: codexRuntimeError(value.cause, depth + 1) } : {}),
  };
}

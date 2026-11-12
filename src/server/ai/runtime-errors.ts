import { getErrorCode, ERROR_CODES, ToolInputValidationError } from '@cjfclonedeep/capability-sdk';

/** Execution intent is durable before invocation; only pre-invocation schema
 * rejection can promise that correcting arguments will not replay a side effect. */
export function runtimeToolFailure(error: unknown, invocationStarted: boolean) {
  const inputRejected = !invocationStarted && error instanceof ToolInputValidationError;
  if (inputRejected) return error.toResult();
  return { ok: false as const,
    outcome: invocationStarted ? 'unknown' as const : 'not-executed' as const,
    actual: error instanceof Error ? error.message : String(error), safeToRetry: false, error: runtimeError(error) };
}

/** Preserve exception evidence before JSON serialization drops Error properties. */
export function runtimeError(error: unknown, depth = 0): Record<string, unknown> {
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
    ...(value.cause !== undefined ? { cause: runtimeError(value.cause, depth + 1) } : {}),
  };
}

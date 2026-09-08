import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyRuntimeRetry,
  parseRetryAfterMs,
  runtimeExecutionIdentity,
  runtimeRetryDelayMs,
  waitForRuntimeRetry,
} from './runtime-retry-policy';

test('runtime retry accepts request failures beyond transient provider and network failures', () => {
  assert.equal(classifyRuntimeRetry({ statusCode: 429, responseHeaders: { 'retry-after': '2' } }).retryable, true);
  assert.equal(classifyRuntimeRetry({ status: 503 }).retryable, true);
  assert.equal(classifyRuntimeRetry(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })).retryable, true);
  assert.deepEqual(classifyRuntimeRetry(new Error('Cannot connect to API: other side closed')), {
    category: 'network',
    reason: 'temporary network failure',
    retryAfterMs: undefined,
    retryable: true,
    statusCode: undefined,
  });
  assert.deepEqual(
    classifyRuntimeRetry(Object.assign(
      new Error('Cannot connect to API: Connect Timeout Error (attempted address: api.deepseek.com:443, timeout: 10000ms)'),
      { cause: Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' }) },
    )),
    {
      category: 'request-timeout',
      reason: 'temporary request timeout',
      retryAfterMs: undefined,
      retryable: true,
      statusCode: undefined,
    },
  );
  assert.equal(classifyRuntimeRetry({ status: 401, message: 'invalid api key' }).retryable, true);
  assert.equal(classifyRuntimeRetry({ status: 400, message: 'invalid tool schema' }).retryable, true);
  assert.equal(classifyRuntimeRetry(new Error('locator.click failed')).retryable, true);
});

test('only billing exhaustion and caller cancellation prevent request retries', () => {
  for (const status of [400, 401, 403, 404, 405, 410, 422, 429, 500, 501, 503, 505]) {
    assert.equal(classifyRuntimeRetry({ status }).retryable, true, `HTTP ${status}`);
  }
  for (const error of [
    new Error('Failed to persist context records before model request.'),
    Object.assign(new Error('context exceeds request budget'), { name: 'RuntimeContextBudgetError' }),
    Object.assign(new Error('request aborted'), { name: 'AbortError' }),
    { code: 'ERR_INVALID_URL', message: 'invalid URL' },
    { code: 'MODEL_NOT_FOUND', message: 'unknown model' },
    { message: 'unknown provider error', isRetryable: false },
  ]) {
    assert.equal(classifyRuntimeRetry(error).retryable, true, error.message);
  }
  for (const error of [
    { status: 403, message: 'Insufficient Balance' },
    { status: 429, code: 'insufficient_quota' },
    { status: 429, type: 'insufficient_quota' },
    { status: 429, code: 'rate_limit_exceeded', type: 'insufficient_quota' },
    new Error('账户余额不足'),
  ]) {
    assert.equal(classifyRuntimeRetry(error).category, 'billing');
    assert.equal(classifyRuntimeRetry(error).retryable, false);
  }
  const controller = new AbortController();
  controller.abort();
  assert.equal(classifyRuntimeRetry(new Error('fetch failed'), controller.signal).retryable, false);
});

test('runtime retry accepts SDK error and other finish states', () => {
  assert.equal(classifyRuntimeRetry(new Error('AI SDK returned retryable finish reason "error".')).retryable, true);
  assert.equal(classifyRuntimeRetry(new Error('AI SDK returned retryable finish reason "other".')).retryable, true);
  assert.deepEqual(classifyRuntimeRetry(Object.assign(new Error('No output generated. Check the stream for errors.'), {
    name: 'AI_NoOutputGeneratedError',
  })), {
    category: 'server-error',
    reason: 'provider stream ended without an output',
    retryAfterMs: undefined,
    retryable: true,
    statusCode: undefined,
  });
  assert.deepEqual(classifyRuntimeRetry(Object.assign(new Error('Insufficient Balance'), { statusCode: 402 })), {
    category: 'billing',
    reason: 'provider balance is unavailable (402)',
    retryable: false,
    statusCode: 402,
  });
});

test('runtime retry does not retry exhausted provider plans reported as HTTP 429', () => {
  assert.deepEqual(classifyRuntimeRetry(Object.assign(
    new Error('已达到 Token Plan 用量上限：请升级 Token Plan 套餐或购买积分补充用量。 (2056)'),
    { statusCode: 429 },
  )), {
    category: 'billing',
    reason: 'provider balance is unavailable (429)',
    retryable: false,
    statusCode: 429,
  });
});

test('private tool protocol keeps retrying within the configured attempt limit', () => {
  const first = Object.assign(new Error('private protocol'), {
    name: 'AI_PrivateToolProtocolError',
    privateToolProtocolRetryable: true,
  });
  const repeated = Object.assign(new Error('private protocol'), {
    name: 'AI_PrivateToolProtocolError',
    privateToolProtocolRetryable: false,
  });
  assert.deepEqual(classifyRuntimeRetry(first), {
    category: 'protocol',
    reason: 'provider emitted a private textual tool protocol',
    retryable: true,
    statusCode: undefined,
  });
  assert.equal(classifyRuntimeRetry(repeated).retryable, true);
});

test('runtime retry honors Retry-After before exponential jitter', () => {
  const decision = classifyRuntimeRetry({ status: 429, headers: { 'retry-after': '1.5' } });
  assert.equal(decision.retryAfterMs, 1500);
  assert.equal(runtimeRetryDelayMs(3, decision, () => 0), 1500);
  assert.equal(parseRetryAfterMs('2'), 2000);
  assert.equal(runtimeRetryDelayMs(1, { category: 'network', reason: 'network', retryable: true }, () => 0.5), 500);
  assert.equal(runtimeRetryDelayMs(2, { category: 'network', reason: 'network', retryable: true }, () => 0.5), 1000);
});

test('runtime execution ids are stable and retry waiting is abortable', async () => {
  assert.deepEqual(runtimeExecutionIdentity('msg_1', 7, 2), {
    turnId: 'msg_1',
    attemptNumber: 2,
    attemptId: 'msg_1:step:7:attempt:2',
  });
  const controller = new AbortController();
  const waiting = waitForRuntimeRetry(10_000, controller.signal);
  controller.abort(new Error('stopped'));
  await assert.rejects(waiting, /stopped/);
});

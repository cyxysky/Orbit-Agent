import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeConfiguration, withRuntimeConfiguration } from '@/server/settings/runtime-configuration';
import { AiFirstChunkTimeoutError, aiRuntimeRequestTimeoutMs, aiRuntimeStreamTimeouts, aiStreamTimeouts, createAiRequestWatchdog } from './ai-sdk-runtime';

test('child first-output retries have a fixed configurable deadline and a stalled provider is aborted', async () => {
  await withRuntimeConfiguration({ ...runtimeConfiguration(), AI_SUBAGENT_FIRST_CHUNK_TIMEOUT_MS: '15' }, async () => {
    assert.deepEqual([0, 1, 2].map(attempt => aiRuntimeStreamTimeouts(1000, attempt, true).firstChunkMs), [15, 15, 15]);
    assert.equal(aiRuntimeStreamTimeouts(10, 2, true).firstChunkMs, 10);
    const watchdog = createAiRequestWatchdog(undefined, 1000);
    try {
      watchdog.waitForFirstChunk(15);
      await assert.rejects(watchdog.run(new Promise<never>(() => {})), AiFirstChunkTimeoutError);
      assert.equal(watchdog.abortSignal.aborted, true);
    } finally { watchdog.dispose(); }
  });
});

test('gives Agent Loop model requests a configurable long deadline', () => {
  withRuntimeConfiguration({ ...runtimeConfiguration(), AI_RUNTIME_REQUEST_TIMEOUT_MS: undefined }, () => {
    assert.equal(aiRuntimeRequestTimeoutMs(), 600_000);
  });
  withRuntimeConfiguration({ ...runtimeConfiguration(), AI_RUNTIME_REQUEST_TIMEOUT_MS: '900000' }, () => {
    assert.equal(aiRuntimeRequestTimeoutMs(), 900_000);
  });
});

test('does not let stream timeouts expire while a tool is still allowed to run', () => {
  withRuntimeConfiguration({ ...runtimeConfiguration(), AI_REQUEST_TIMEOUT_MS: '30000',
    AI_STREAM_FIRST_CHUNK_TIMEOUT_MS: '20000', AI_STREAM_CHUNK_TIMEOUT_MS: '15000', AI_TOOL_TIMEOUT_MS: '120000' }, () => {
    assert.deepEqual(aiStreamTimeouts(), {
      firstChunkMs: 20000,
      chunkMs: 150000,
      toolMs: 120000,
    });
  });
});

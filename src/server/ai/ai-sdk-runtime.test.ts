import assert from 'node:assert/strict';
import test from 'node:test';
import { AiFirstChunkTimeoutError, aiRuntimeRequestTimeoutMs, aiRuntimeStreamTimeouts, aiStreamTimeouts, createAiRequestWatchdog } from './ai-sdk-runtime';

test('child first-output retries have a fixed configurable deadline and a stalled provider is aborted', async () => {
  const previous = process.env.AI_SUBAGENT_FIRST_CHUNK_TIMEOUT_MS;
  process.env.AI_SUBAGENT_FIRST_CHUNK_TIMEOUT_MS = '15';
  try {
    assert.deepEqual([0, 1, 2].map(attempt => aiRuntimeStreamTimeouts(1000, attempt, true).firstChunkMs), [15, 15, 15]);
    assert.equal(aiRuntimeStreamTimeouts(10, 2, true).firstChunkMs, 10);
    const watchdog = createAiRequestWatchdog(undefined, 1000);
    try {
      watchdog.waitForFirstChunk(15);
      await assert.rejects(watchdog.run(new Promise<never>(() => {})), AiFirstChunkTimeoutError);
      assert.equal(watchdog.abortSignal.aborted, true);
    } finally { watchdog.dispose(); }
  } finally {
    if (previous === undefined) delete process.env.AI_SUBAGENT_FIRST_CHUNK_TIMEOUT_MS;
    else process.env.AI_SUBAGENT_FIRST_CHUNK_TIMEOUT_MS = previous;
  }
});

test('gives Agent Loop model requests a configurable long deadline', () => {
  const original = process.env.AI_RUNTIME_REQUEST_TIMEOUT_MS;
  delete process.env.AI_RUNTIME_REQUEST_TIMEOUT_MS;
  try {
    assert.equal(aiRuntimeRequestTimeoutMs(), 600_000);
    process.env.AI_RUNTIME_REQUEST_TIMEOUT_MS = '900000';
    assert.equal(aiRuntimeRequestTimeoutMs(), 900_000);
  } finally {
    if (original === undefined) delete process.env.AI_RUNTIME_REQUEST_TIMEOUT_MS;
    else process.env.AI_RUNTIME_REQUEST_TIMEOUT_MS = original;
  }
});

test('does not let stream timeouts expire while a tool is still allowed to run', () => {
  const original = {
    request: process.env.AI_REQUEST_TIMEOUT_MS,
    firstChunk: process.env.AI_STREAM_FIRST_CHUNK_TIMEOUT_MS,
    chunk: process.env.AI_STREAM_CHUNK_TIMEOUT_MS,
    tool: process.env.AI_TOOL_TIMEOUT_MS,
  };

  process.env.AI_REQUEST_TIMEOUT_MS = '30000';
  process.env.AI_STREAM_FIRST_CHUNK_TIMEOUT_MS = '20000';
  process.env.AI_STREAM_CHUNK_TIMEOUT_MS = '15000';
  process.env.AI_TOOL_TIMEOUT_MS = '120000';

  try {
    assert.deepEqual(aiStreamTimeouts(), {
      firstChunkMs: 20000,
      chunkMs: 150000,
      toolMs: 120000,
    });
  } finally {
    for (const [key, value] of Object.entries({
      AI_REQUEST_TIMEOUT_MS: original.request,
      AI_STREAM_FIRST_CHUNK_TIMEOUT_MS: original.firstChunk,
      AI_STREAM_CHUNK_TIMEOUT_MS: original.chunk,
      AI_TOOL_TIMEOUT_MS: original.tool,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

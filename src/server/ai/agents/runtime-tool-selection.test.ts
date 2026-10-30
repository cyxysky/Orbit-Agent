import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runtimeAllowedToolTypes,
  runtimeToolRequiresBrowserSession,
  runtimeToolLoopStopToolNames,
} from './runtime-tool-selection';

const nativeToolNames = ['browser', 'file'];
const observationToolNames = new Set<string>();

test('runtimeAllowedToolTypes keeps native tools outside Codex mode', () => {
  assert.deepEqual(runtimeAllowedToolTypes({
    browserChatMode: false,
    codexMode: false,
    nativeToolNames,
    observationToolNames,
  }), nativeToolNames);
});

test('runtimeAllowedToolTypes adds answer in Codex browser chat', () => {
  assert.deepEqual(runtimeAllowedToolTypes({
    browserChatMode: true,
    codexMode: true,
    nativeToolNames,
    observationToolNames,
  }), ['browser', 'file', 'answer']);
});

test('the unified browser tool uses the generic session-start hook', () => {
  assert.equal(runtimeToolRequiresBrowserSession('browser'), true);
  assert.equal(runtimeToolRequiresBrowserSession('subagent'), false);
  assert.equal(runtimeToolRequiresBrowserSession('file'), false);
});

test('subagent calls end the current runtime tool loop', () => {
  assert.deepEqual(runtimeToolLoopStopToolNames, ['finalResponse', 'subagent']);
});

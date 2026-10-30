import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  mergeBrowserChatRealtimeCollections,
  mergeBrowserChatRealtimeRecords,
  parseBrowserChatRealtimePatch,
} from './browser-chat-realtime-model';

test('realtime record patches retain rendered subagents while updating their status', () => {
  const current = [
    { id: 'subagent-1', status: 'running', steps: [{ index: 1 }] },
    { id: 'subagent-2', status: 'passed', steps: [{ index: 2 }] },
  ];
  const merged = mergeBrowserChatRealtimeRecords(current, [
    { id: 'subagent-1', status: 'passed' },
  ]);
  assert.deepEqual(merged, [
    { id: 'subagent-1', status: 'passed', steps: [{ index: 1 }] },
    { id: 'subagent-2', status: 'passed', steps: [{ index: 2 }] },
  ]);
  assert.deepEqual(mergeBrowserChatRealtimeRecords(current, []), current);
});

test('browser-chat realtime collections replace newer records and prune removals', () => {
  const merged = mergeBrowserChatRealtimeCollections({
    messages: [
      { id: 'old', createdAt: '1', updatedAt: '1' },
      { id: 'keep', createdAt: '2', updatedAt: '2', value: 'before' },
    ],
    steps: [{ index: 1, value: 'remove' }, { index: 2, value: 'before' }],
    logs: [{ id: 'old-log', time: '1' }],
  }, {
    removedMessageIds: ['old'],
    removedStepIndexes: [1],
    removedLogIds: ['old-log'],
    messages: [{ id: 'keep', createdAt: '2', updatedAt: '3', value: 'after' }],
    steps: [{ index: 2, value: 'after' }],
    logs: [{ id: 'new-log', time: '2' }],
  });
  assert.deepEqual(merged.messages, [{ id: 'keep', createdAt: '2', updatedAt: '3', value: 'after' }]);
  assert.deepEqual(merged.steps, [{ index: 2, value: 'after' }]);
  assert.deepEqual(merged.logs, [{ id: 'new-log', time: '2' }]);
});

test('browser-chat realtime patch parser rejects missing session identities', () => {
  assert.equal(parseBrowserChatRealtimePatch({ session: {} }), undefined);
  assert.deepEqual(parseBrowserChatRealtimePatch({ session: { id: 'chat-1' } }), { session: { id: 'chat-1' } });
});

test('stale tool-start snapshots cannot regress a completed realtime tool', () => {
  const merged = mergeBrowserChatRealtimeCollections({
    messages: [],
    logs: [],
    steps: [{
      index: 4,
      status: 'running',
      tools: [
        { id: 'tool-1', name: 'file', ok: true, result: 'done', elapsedMs: 1200 },
        { id: 'tool-2', name: 'file', ok: undefined },
      ],
    }],
  }, {
    steps: [{
      index: 4,
      status: 'running',
      tools: [{ id: 'tool-1', name: 'file', ok: undefined, elapsedMs: 0 }],
    }],
  });
  assert.deepEqual(merged.steps[0].tools, [
    { id: 'tool-1', name: 'file', ok: true, result: 'done', elapsedMs: 1200 },
    { id: 'tool-2', name: 'file', ok: undefined },
  ]);
});

test('a delayed asynchronous spawn acknowledgement cannot erase its completed result or another batch', () => {
  const completedTool = {
    id: 'batch-1',
    name: 'subagent',
    ok: false,
    rawResult: {
      ok: false,
      actual: JSON.stringify({
        batchId: 'batch-1', asynchronous: true, status: 'completed',
        subagents: [{ uuid: 'child-1', status: 'failed', summary: 'Retained evidence', error: 'Timeout' }],
      }),
    },
  };
  const pendingTool = (id: string) => ({
    id,
    name: 'subagent',
    ok: true,
    rawResult: { ok: true, actual: JSON.stringify({ batchId: id, asynchronous: true, status: 'running' }) },
  });
  const current = { messages: [], logs: [], steps: [{ index: 4, tools: [completedTool] }] };
  const merged = mergeBrowserChatRealtimeCollections(current, {
    steps: [{ index: 4, tools: [pendingTool('batch-1'), pendingTool('batch-2')] }],
  });
  assert.deepEqual(merged.steps[0].tools, [completedTool, pendingTool('batch-2')]);
  const completedWithRevision: typeof completedTool & { error?: string } = { ...completedTool, error: 'Old failure', rawResult: {
    ...completedTool.rawResult,
    actual: JSON.stringify({ ...JSON.parse(completedTool.rawResult.actual), revision: 4 }),
  } };
  const resumedTool = { ...pendingTool('batch-1'), error: undefined, rawResult: {
    ok: true,
    actual: JSON.stringify({ batchId: 'batch-1', asynchronous: true, status: 'running', revision: 5 }),
  } };
  const resumed = mergeBrowserChatRealtimeCollections({
    ...current, steps: [{ index: 4, tools: [completedWithRevision] }],
  }, { steps: [{ index: 4, tools: [resumedTool] }] });
  assert.equal(resumed.steps[0].tools[0].error, undefined);
  assert.equal(resumed.steps[0].tools[0].ok, true);
  const lateCompletion = mergeBrowserChatRealtimeCollections(resumed, {
    steps: [{ index: 4, tools: [completedWithRevision] }],
  });
  assert.deepEqual(lateCompletion.steps[0].tools, resumed.steps[0].tools);
});

test('a parent turn finished in the same millisecond cannot be revived by its delayed running message', () => {
  const message = { id: 'parent', status: 'blocked', updatedAt: '2026-10-02T00:00:00.000Z' };
  const current = { messages: [message], logs: [], steps: [] };
  const stale = mergeBrowserChatRealtimeCollections(current, {
    messages: [{ ...message, status: 'running' }],
  });
  assert.strictEqual(stale.messages[0], message);
  const resumed = mergeBrowserChatRealtimeCollections(current, {
    messages: [{ ...message, status: 'running', updatedAt: '2026-10-02T00:00:01.000Z' }],
  });
  assert.equal(resumed.messages[0].status, 'running');
});

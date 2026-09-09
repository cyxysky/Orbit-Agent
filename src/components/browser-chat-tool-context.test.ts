import { expect, test } from 'vitest';
import { browserChatAiOutputCycleFromDebugEvent } from '../lib/browser-chat-output-cycles';
import { browserChatCurrentTurnAssistantMessageId } from './browser-chat-output-files-state';
import { nextBrowserChatActivity } from '@/lib/browser-chat-activity';
import { mergeBrowserChatToolDetail, type BrowserChatToolDetail } from './browser-chat-ai-output';
import {
  browserChatToolContextTokenMetrics,
  browserChatToolTimingMetrics,
} from './browser-chat-tool-context';

test('computes complete tool context token deltas including decreases', () => {
  expect(browserChatToolContextTokenMetrics({
    contextBefore: { estimatedTotalTokens: 12_400 },
    contextAfter: { estimatedTotalTokens: 13_025 },
  })).toEqual({ before: 12_400, after: 13_025, delta: 625 });
  expect(browserChatToolContextTokenMetrics({
    contextBefore: { estimatedTotalTokens: 80_000 },
    contextAfter: { estimatedTotalTokens: 31_000 },
  })).toEqual({ before: 80_000, after: 31_000, delta: -49_000 });
});

test('times each request and tool separately while preserving its clock through heartbeats', () => {
  let activity = nextBrowserChatActivity({ phase: 'ai:runtime:dispatch', operationId: 'ai:request-1', label: 'request', timestamp: '2026-09-09T10:00:00.000Z' });
  const advance = (seconds: number, phase: string, operationId?: string) => {
    activity = nextBrowserChatActivity({ phase, operationId, label: phase, previous: activity,
      timestamp: new Date(Date.parse('2026-09-09T10:00:00.000Z') + seconds * 1000).toISOString(), elapsedMs: 0 });
  };
  advance(10, 'ai:runtime:dispatch', 'ai:request-1');
  advance(20, 'ai:runtime:receiving', 'ai:request-1');
  expect(activity.startedAt).toBe('2026-09-09T10:00:00.000Z');
  advance(25, 'tool:running', 'tool:call-1');
  advance(35, 'tool:progress', 'tool:call-1');
  advance(45, 'browser:screenshot:after');
  expect(activity.startedAt).toBe('2026-09-09T10:00:25.000Z');
  advance(50, 'tool:running', 'tool:call-2');
  advance(60, 'tool:completed', 'tool:call-2');
  expect(activity.startedAt).toBe('2026-09-09T10:00:50.000Z');
  advance(65, 'ai:runtime:dispatch', 'ai:request-2');
  advance(75, 'ai:text:streaming');
  expect(activity.startedAt).toBe('2026-09-09T10:01:05.000Z');
  advance(80, 'ai:runtime:dispatch', 'ai:request-2-retry');
  expect(activity.startedAt).toBe('2026-09-09T10:01:20.000Z');
});

test('retains full dialog parameters and elapsed time after compact realtime updates', () => {
  const program = 'complete source\n'.repeat(4000);
  const detail: BrowserChatToolDetail = { stepIndex: 1, toolIndex: 0,
    step: { index: 1, action: 'edit', expected: '', actual: '', status: 'running' },
    tool: { id: 'tool-1', name: 'file', input: { program }, elapsedMs: 32000, aiRequestElapsedMs: 1400 } };
  const merged = mergeBrowserChatToolDetail(detail, { ...detail, tool: { ...detail.tool,
    input: { program: '… [60000 chars omitted from realtime payload; full value is stored] …' }, elapsedMs: 0, aiRequestElapsedMs: 0 } });
  expect(merged.tool.input).toEqual({ program });
  expect(merged.tool.elapsedMs).toBe(32000);
  expect(merged.tool.aiRequestElapsedMs).toBe(1400);
});

test('does not compare legacy raw history with a prepared request', () => {
  const before = { requestId: 'request-1', estimatedTotalTokens: 24_059 };
  expect(browserChatToolContextTokenMetrics({
    name: 'contextRead', contextBefore: before,
    contextAfter: { estimatedTotalTokens: 43_723 },
  })).toEqual({ before: 24_059, after: undefined, delta: undefined });
  expect(browserChatToolContextTokenMetrics({
    name: 'contextRead', contextBefore: before,
    contextAfter: { requestId: 'request-2', estimatedTotalTokens: 28_350 },
  })).toEqual({ before: 24_059, after: 28_350, delta: 4_291 });
  expect(browserChatToolContextTokenMetrics({
    name: 'contextCompression', contextBefore: before,
    contextAfter: { estimatedTotalTokens: 12_000 },
  })).toEqual({ before: 24_059, after: 12_000, delta: -12_059 });
});

test('normalizes tool and provider API elapsed times', () => {
  expect(browserChatToolTimingMetrics({
    elapsedMs: 12_345.4,
    aiRequestElapsedMs: 2_345.6,
  })).toEqual({
    toolElapsedMs: 12_345,
    aiRequestElapsedMs: 2_346,
  });
  expect(browserChatToolTimingMetrics({
    elapsedMs: -1,
    aiRequestElapsedMs: Number.NaN,
  })).toEqual({
    toolElapsedMs: undefined,
    aiRequestElapsedMs: undefined,
  });
});

test('keeps the previous output list collapsed as soon as a new user turn starts', () => {
  const firstTurn = [
    { id: 'user-1', role: 'user' as const },
    { id: 'assistant-1', role: 'assistant' as const },
  ];
  expect(browserChatCurrentTurnAssistantMessageId(firstTurn)).toBe('assistant-1');
  expect(browserChatCurrentTurnAssistantMessageId([
    ...firstTurn,
    { id: 'user-2', role: 'user' as const },
  ])).toBeUndefined();
  expect(browserChatCurrentTurnAssistantMessageId([
    ...firstTurn,
    { id: 'user-2', role: 'user' as const },
    { id: 'assistant-2', role: 'assistant' as const },
  ])).toBe('assistant-2');
});

test('turns context compression completion into an ordered tool output cycle', () => {
  const cycle = browserChatAiOutputCycleFromDebugEvent({
    details: {
      estimatedTokensBefore: 92_000,
      estimatedTokensAfter: 34_000,
      toolCallId: 'context-compression:run:1:1',
    },
    id: 'cycle-1',
    messageId: 'assistant-1',
    phase: 'ai:context-compression:complete',
    stepIndex: 1,
  });

  expect(cycle?.output.tools[0]?.id).toBe('context-compression:run:1:1');
  expect(cycle?.output.tools[0]?.name).toBe('contextCompression');
  expect(cycle?.output.tools[0]?.input).toEqual({
    estimatedTokensBefore: 92_000,
    estimatedTokensAfter: 34_000,
  });
  expect(cycle?.output.tools[0]?.ok).toBe(true);
});

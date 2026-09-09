import { expect, test } from 'vitest';
import type { StepExecutionResult } from '@/server/ai/schemas/runtime.schema';
import { recoverBrowserChatToolContext } from './browser-chat-tool-context-recovery';

const steps: StepExecutionResult[] = [{ index: 1, messageId: 'turn-1', action: 'read', expected: '', actual: '', status: 'passed', tools: [
  { name: 'contextRead', contextBefore: { requestId: 'r1', requestCreatedAt: '2026-09-09T10:00:00.000Z', estimatedTotalTokens: 24059 }, contextAfter: { estimatedTotalTokens: 43723 } },
  { name: 'contextRead', contextBefore: { requestId: 'r2', requestCreatedAt: '2026-09-09T10:00:02.000Z', estimatedTotalTokens: 28350 }, contextAfter: { estimatedTotalTokens: 48035 } },
] }];
const logs = [24059, 28350, 32662].map((total, i) => ({
  id: `log-${i}`, messageId: 'turn-1', time: `2026-09-09T10:00:0${i * 2}.100Z`, phase: 'ai:runtime:request',
  details: JSON.stringify({ aiInputTokens: { estimatedTotalTokens: total, estimatedTextTokens: total - 1000, estimatedToolSchemaTokens: 1000 } }),
}));

test('recovers adjacent request counts without rewriting legacy evidence', () => {
  const recovered = recoverBrowserChatToolContext(steps, logs);
  expect(recovered[0].tools?.[0].contextAfter).toMatchObject({ requestId: 'r2', estimatedTotalTokens: 28350 });
  expect(recovered[0].tools?.[1].contextAfter?.estimatedTotalTokens).toBe(32662);
  expect(steps[0].tools?.[0].contextAfter?.estimatedTotalTokens).toBe(43723);
});

test('does not guess when the originating request is missing or cross into another turn', () => {
  expect(recoverBrowserChatToolContext(steps, logs.slice(1))[0].tools?.[0].contextAfter?.estimatedTotalTokens).toBe(43723);
  const otherTurn = [logs[0], { ...logs[1], messageId: 'turn-2' }];
  expect(recoverBrowserChatToolContext(steps, otherTurn)[0].tools?.[0].contextAfter?.estimatedTotalTokens).toBe(43723);
});

test('leaves current request snapshots and compression statistics intact', () => {
  const current = structuredClone(steps);
  current[0].tools![0].contextAfter = { requestId: 'correct-r2', estimatedTotalTokens: 28350 };
  current[0].tools![1].name = 'contextCompression';
  expect(recoverBrowserChatToolContext(current, logs)).toEqual(current);
});

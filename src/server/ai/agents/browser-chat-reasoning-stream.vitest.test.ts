import { expect, it } from 'vitest';
import { streamText, ToolLoopAgent } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { createReasoningStreamObserver, type ReasoningStreamUpdate } from './browser-chat-reasoning-stream';
import { mergeBrowserChatStreamPart } from '@/lib/browser-chat-output-cycles';

it.each(['streamText', 'ToolLoopAgent'])('%s publishes reasoning before the provider completes, without mixing it into the answer', async loop => {
  const updates: ReasoningStreamUpdate[] = [];
  let firstDelta!: () => void;
  const first = new Promise<void>(resolve => { firstDelta = resolve; });
  const observe = createReasoningStreamObserver(update => { updates.push(update); firstDelta(); });
  let source!: ReadableStreamDefaultController<LanguageModelV4StreamPart>;
  const model = new MockLanguageModelV4({ doStream: async () => ({
    stream: new ReadableStream<LanguageModelV4StreamPart>({ start(controller) { source = controller;
      controller.enqueue({ type: 'stream-start', warnings: [] });
      controller.enqueue({ type: 'reasoning-start', id: 'r1' });
      controller.enqueue({ type: 'reasoning-delta', id: 'r1', delta: 'Inspect' });
    } }).pipeThrough(new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
      async transform(part, controller) { await observe(part); controller.enqueue(part); },
    })),
  }) });
  const result = loop === 'streamText' ? streamText({ model, prompt: 'example' })
    : await new ToolLoopAgent({ model }).stream({ prompt: 'example' });
  let completed = false;
  const answer = result.text.then(text => { completed = true; return text; });
  await first;
  expect(completed).toBe(false);
  expect(updates).toEqual([{ index: 0, text: 'Inspect', active: true }]);
  source.enqueue({ type: 'reasoning-delta', id: 'r1', delta: ' the diagram' });
  source.enqueue({ type: 'reasoning-end', id: 'r1' });
  source.enqueue({ type: 'text-start', id: 'answer' });
  source.enqueue({ type: 'text-delta', id: 'answer', delta: 'Done' });
  source.enqueue({ type: 'text-end', id: 'answer' });
  source.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: undefined },
    usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 3, text: 1, reasoning: 2 } } });
  source.close();
  expect(await answer).toBe('Done');
  expect(updates.at(-1)).toEqual({ index: 0, text: 'Inspect the diagram', active: false });
});

it('preserves earlier reasoning when text arrives and appends a later reasoning segment in order', async () => {
  const reasoning = mergeBrowserChatStreamPart(undefined, { kind: 'reasoning', index: 0, text: 'First' });
  const withText = mergeBrowserChatStreamPart(reasoning, { kind: 'text', index: 0, text: 'Progress' });
  const next = mergeBrowserChatStreamPart(withText, { kind: 'reasoning', index: 1, text: 'Second' });
  const updated = mergeBrowserChatStreamPart(next, { kind: 'reasoning', index: 1, text: 'Second delta' });
  expect(updated.parts).toEqual([{ kind: 'reasoning', index: 0 }, { kind: 'text', index: 0 }, { kind: 'reasoning', index: 1 }]);
  expect(updated.reasoning).toEqual(['First', 'Second delta']);
  expect(updated.texts).toEqual(['Progress']);
  expect(reasoning.texts).toEqual([]);
  expect(next.reasoning[1]).toBe('Second');
  const updates: ReasoningStreamUpdate[] = [];
  const observe = createReasoningStreamObserver(update => { updates.push(update); });
  await observe({ type: 'reasoning-delta', id: 'no-start', delta: 'partial' });
  await observe({ type: 'finish' });
  expect(updates.at(-1)?.active).toBe(false);
});

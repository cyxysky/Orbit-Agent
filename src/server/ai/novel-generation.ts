import { streamText } from 'ai';
import { raceWithAbort, type CapabilityExecutionContext } from '@cjfclonedeep/capability-sdk';
import { getModel } from './model';
import { aiReasoningEffort, aiTelemetry } from './ai-sdk-runtime';

export async function generateNovelText(input: {
  instructions: string; prompt: string; functionId: string; label: string; temperature?: number;
}, context: CapabilityExecutionContext) {
  context.abortSignal?.throwIfAborted();
  const controller = new AbortController();
  // Novel AI operations have no local deadline; the caller can still cancel.
  const signal = context.abortSignal ? AbortSignal.any([controller.signal, context.abortSignal]) : controller.signal;
  let lastProgress = Date.now(), chunks = 0, textCharacters = 0, reasoningCharacters = 0;
  let streamAbortReason: unknown;
  try {
    return await raceWithAbort((async () => {
      const result = streamText({ model: getModel(), instructions: input.instructions, prompt: input.prompt,
        temperature: input.temperature, reasoning: aiReasoningEffort(), maxRetries: 0,
        abortSignal: signal,
        telemetry: aiTelemetry(input.functionId), onError: () => undefined,
        onAbort: (event) => { if ('reason' in event) streamAbortReason = event.reason; } });
      for await (const part of result.fullStream) {
        if (part.type === 'error') throw part.error;
        if (part.type === 'abort') throw streamAbortReason ?? new Error(part.reason || 'Novel request aborted.');
        if (part.type !== 'text-delta' && part.type !== 'reasoning-delta') continue;
        chunks++;
        if (part.type === 'text-delta') textCharacters += part.text.length;
        else reasoningCharacters += part.text.length;
        if (Date.now() - lastProgress >= 1500) {
          lastProgress = Date.now();
          const outputProgress = part.type === 'reasoning-delta'
            ? `正在接收推理（${reasoningCharacters.toLocaleString('zh-CN')} 字符${textCharacters ? '' : '，尚无正文'}）`
            : `正在接收正文（${textCharacters.toLocaleString('zh-CN')} 字符）`;
          await context.reportProgress?.({ phase: input.functionId, message: `${input.label} · ${outputProgress}`, data: { chunks, textCharacters, reasoningCharacters } });
        }
      }
      signal.throwIfAborted();
      const finishReason = await result.finishReason, usage = await result.usage;
      const diagnostics = { outputTokens: usage.outputTokens, reasoningTokens: usage.outputTokenDetails.reasoningTokens, textCharacters, reasoningCharacters };
      await context.reportProgress?.({ phase: input.functionId, message: `${input.label} · ${finishReason === 'length' ? '模型输出达到长度上限' : '本次响应结束'}`, data: { finishReason, ...diagnostics } });
      return { text: await result.text, finishReason, diagnostics };
    })(), signal);
  } finally { controller.abort(); }
}

import type { ResponseBlock, StructuredResponse } from '@webpilot/capability-sdk';
import { responseRegistry } from '@/lib/response-registry';
import { browserChatCapabilityResult } from './browser-chat-capability-result';
import type { DynamicToolUIPart, UIMessage } from 'ai';
import { z } from 'zod';
import type {
  BrowserChatAiOutputCycle,
  BrowserChatSubagentRecord,
  StepExecutionResult,
} from '@/server/ai/schemas/runtime.schema';

// Persist the envelope independently of installed packages, so one missing renderer
// cannot prevent a whole historical automation run from loading.
export const browserChatFinalBlockSchema = z.object({
  type: z.string().min(1).max(160), params: z.record(z.string(), z.unknown()),
}).strict();
export const browserChatFinalResponseSchema = z.unknown().transform((value, context): StructuredResponse => {
  try { return responseRegistry.parseResponse(value); }
  catch (error) { context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) }); return z.NEVER; }
});
export type BrowserChatFinalBlock = ResponseBlock;
export type BrowserChatFinalResponse = StructuredResponse;

export type BrowserChatUIMessageMetadata = {
  sessionId: string;
  clientMessageId?: string;
  createdAt: string;
  updatedAt?: string;
  status?: 'queued' | 'running' | 'passed' | 'failed' | 'blocked' | 'interrupted';
  attachments?: unknown[];
  skillIds?: string[];
};

export type BrowserChatUIDataTypes = {
  response: ResponseBlock;
  step: StepExecutionResult;
  outputCycle: BrowserChatAiOutputCycle;
  subagent: BrowserChatSubagentRecord;
  activity: { phase: string; label: string; updatedAt: string; startedAt?: string; operationId?: string };
};

export type BrowserChatUIMessage = UIMessage<BrowserChatUIMessageMetadata, BrowserChatUIDataTypes>;
export type BrowserChatUIMessagePart = BrowserChatUIMessage['parts'][number];

export function browserChatFinalBlocksToParts(blocks: BrowserChatFinalBlock[]): BrowserChatUIMessagePart[] {
  return blocks.map((block, index) => ({ type: 'data-response', id: `response:${index}`, data: block }));
}

export function browserChatFinalBlocksToText(blocks: BrowserChatFinalBlock[]) {
  return blocks.map(block => responseRegistry.toText(block)).filter(Boolean).join('\n\n');
}

export function browserChatToolPartFromStep(
  step: StepExecutionResult,
  toolIndex: number,
): DynamicToolUIPart | undefined {
  const tool = step.tools?.[toolIndex];
  if (!tool || tool.name === 'finalResponse') return undefined;
  const base = {
    type: 'dynamic-tool' as const,
    toolName: tool.name,
    toolCallId: tool.id || `step-${step.index}-tool-${toolIndex}`,
    input: tool.input,
  };
  if (tool.ok === true) {
    const responses = responseRegistry.toolBlocks(tool.name, browserChatCapabilityResult(tool.rawResult ?? tool.result));
    return { ...base, state: 'output-available', output: responses.length
      ? { ok: true, summary: tool.result, content: responses.map(block => ({ type: 'response', block })) }
      : tool.result ?? null };
  }
  if (tool.ok === false || tool.error) {
    return { ...base, state: 'output-error', errorText: tool.error || tool.result || 'Tool execution failed.' };
  }
  return { ...base, state: 'input-available' };
}

export function browserChatExecutionParts(steps: StepExecutionResult[]): BrowserChatUIMessagePart[] {
  return [...steps]
    .sort((left, right) => left.index - right.index)
    .flatMap((step) => {
      if (step.tools?.length && step.tools.every((tool) => tool.name === 'finalResponse')) return [];
      return [
        ...((step.tools || []).flatMap((_tool, toolIndex) => {
        const part = browserChatToolPartFromStep(step, toolIndex);
        return part ? [part] : [];
        })),
        { type: 'data-step' as const, id: `step-${step.index}`, data: step },
      ];
    });
}

/** Shared projection for live messages, persisted conversations and automation views. */
export function browserChatResponseParts(parts: BrowserChatUIMessagePart[] | undefined, fallbackText: string): BrowserChatUIMessagePart[] {
  const response = (parts || []).filter(part => part.type === 'text' || part.type === 'data-response');
  const generated = (parts || []).flatMap((part) => {
    if (part.type === 'dynamic-tool' && part.state === 'output-available') return responseRegistry.toolBlocks(part.toolName, browserChatCapabilityResult(part.output));
    if (part.type === 'data-step') return (part.data.tools || []).flatMap(tool => tool.ok === true
      ? responseRegistry.toolBlocks(tool.name, browserChatCapabilityResult(tool.rawResult ?? tool.result)) : []);
    return [];
  });
  const missing = responseRegistry.missing(response.flatMap(part => part.type === 'data-response' ? [part.data] : []), generated);
  return [...(response.length ? response : fallbackText ? [{ type: 'text' as const, text: fallbackText }] : []),
    ...missing.map(block => ({ type: 'data-response' as const, id: `tool-response:${responseRegistry.identity(block)}`, data: block }))];
}

import type { ModelMessage } from 'ai';
import type { BrowserChatAiOutputCycle, StepExecutionResult } from '@/server/ai/schemas/runtime.schema';
import { browserChatAiOutputCycleFromDebugEvent } from '@/lib/browser-chat-output-cycles';

/** Repair missing presentation events from saved receipts, without executing or altering a Codex thread. */
export function recoverCodexBrowserChatOutputCycles(
  messages: ModelMessage[], steps: StepExecutionResult[], cycles: BrowserChatAiOutputCycle[],
) {
  const displayed = new Set(cycles.flatMap(cycle => cycle.output.tools.map(tool => tool.id)));
  const byCall = new Map(steps.filter(step => step.status !== 'running' && step.messageId
    && step.aiRequest?.options?.engine === 'codex-app-server'
    && step.tools?.some(tool => tool.id && !displayed.has(tool.id)))
    .flatMap(step => (step.tools || []).flatMap(tool => tool.id ? [[tool.id, { step, tool }] as const] : [])));
  if (!byCall.size) return cycles;
  let output = cycles;
  let segment: ModelMessage[] = [];
  const recover = () => {
    const calls = segment.flatMap(message => Array.isArray(message.content)
      ? message.content.flatMap(part => part.type === 'tool-call' && byCall.has(part.toolCallId) ? [byCall.get(part.toolCallId)!] : []) : []);
    const messageIds = new Set(calls.map(call => call.step.messageId!));
    if (messageIds.size !== 1) return;
    const messageId = [...messageIds][0];
    const stepIndex = calls[0].step.index;
    const existing = cycles.filter(cycle => cycle.messageId === messageId);
    // Only repair turns whose tool positions were never recorded; leave newer, complete native cycles intact.
    if (existing.some(cycle => cycle.output.tools.some(tool => byCall.has(tool.id)))) return;
    const recovered: BrowserChatAiOutputCycle[] = [];
    let legacyAgentStep = 1;
    const includedReasoning = new Set<number>();
    for (const message of segment) {
      if (message.role !== 'assistant') continue;
      const parts = typeof message.content === 'string' ? [{ type: 'text' as const, text: message.content }]
        : message.content.filter(part => part.type === 'text' || part.type === 'tool-call');
      const content: unknown[] = [];
      if (!includedReasoning.has(legacyAgentStep)) {
        includedReasoning.add(legacyAgentStep);
        for (const cycle of existing.filter(cycle => cycle.agentStepIndex === legacyAgentStep)) {
          for (const text of cycle.output.reasoning) content.push({ type: 'reasoning', text });
        }
      }
      for (const part of parts) {
        if (part.type === 'text') content.push(part);
        else if (part.type === 'tool-call') {
          const call = byCall.get(part.toolCallId);
          if (!call || call.step.messageId !== messageId) continue;
          content.push(part);
          const result = call.tool.rawResult ?? { ok: call.tool.ok, actual: call.tool.error || call.tool.result };
          content.push({ type: 'tool-result', toolCallId: part.toolCallId, output: result });
          legacyAgentStep++;
        }
      }
      const cycle = browserChatAiOutputCycleFromDebugEvent({
        id: '', messageId, stepIndex, phase: 'ai:runtime:response',
        sequence: (existing[0]?.sequence || 0) + recovered.length / 10000,
        createdAt: existing[0]?.createdAt,
        details: { aiOutput: { engine: 'codex-app-server', itemId: `archive_${recovered.length}`,
          agentStepIndex: recovered.length + 1, response: { content } } },
      });
      if (cycle) recovered.push(cycle);
    }
    const restored = new Set(recovered.flatMap(cycle => cycle.output.tools.map(tool => tool.id)));
    if (!calls.every(call => restored.has(call.tool.id!))) return;
    output = [...output.filter(cycle => cycle.messageId !== messageId), ...recovered];
  };
  for (const message of messages) {
    if (message.role === 'user') { recover(); segment = []; }
    segment.push(message);
  }
  recover();
  return output;
}

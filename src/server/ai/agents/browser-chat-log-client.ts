import { asRecord } from '@/lib/unknown-value';
import { executionStatusText, publicExecutionDetails } from '@/lib/execution-log-presentation';

type BrowserChatClientLog = {
  details?: string;
  id?: string;
  message?: string;
  phase: string;
  stepIndex?: number;
  time?: string;
  toolCallId?: string;
};

function parsedDetails(value: string) {
  const details = asRecord(JSON.parse(value));
  const payload = asRecord(details?.value) || details;
  if (!payload) return undefined;
  return details?.execution && payload.execution === undefined
    ? { ...payload, execution: details.execution }
    : payload;
}

export function compactBrowserChatLogForClient<TLog extends BrowserChatClientLog>(log: TLog): TLog {
  log = { ...log, ...(log.message ? { message: executionStatusText(log.message) } : {}) };
  if (log.details) {
    try { log = { ...log, details: JSON.stringify(publicExecutionDetails(JSON.parse(log.details))) }; }
    catch { log = { ...log, details: executionStatusText(log.details || '') }; }
  }
  if (!log.details) return log;

  if (log.phase === 'ai:runtime:request') {
    try {
      const details = parsedDetails(log.details);
      if (!details || details.aiInput === undefined) return log;
      const aiInput = details.aiInput;
      const compactedDetails = JSON.stringify({
        aiInput,
        aiInputTokens: details?.aiInputTokens,
        engine: details.engine,
        threadId: details.threadId,
        codexTurnId: details.codexTurnId,
        modelRequestId: details.modelRequestId,
        execution: details?.execution,
      });
      return { ...log, details: compactedDetails };
    } catch {
      const compacted = { ...log };
      delete compacted.details;
      return compacted;
    }
  }

  if (log.phase !== 'ai:runtime:response' && log.phase !== 'ai:runtime:object') return log;

  try {
    const details = parsedDetails(log.details);
    const aiOutput = asRecord(details?.aiOutput);
    if (!aiOutput) return log;

    const rawResponse = aiOutput.response;
    const responseRecord = asRecord(rawResponse);
    const response = responseRecord && Object.hasOwn(responseRecord, 'content')
      ? {
          content: responseRecord.content,
          finishReason: responseRecord.finishReason,
          reasoningText: responseRecord.reasoningText,
          text: responseRecord.text,
          toolCalls: responseRecord.toolCalls,
          usage: responseRecord.usage,
          phase: responseRecord.phase,
        }
      : rawResponse;
    const compactedDetails = JSON.stringify({
      aiOutput: {
        responseType: aiOutput.responseType,
        engine: aiOutput.engine,
        itemId: aiOutput.itemId,
        agentStepIndex: aiOutput.agentStepIndex,
        finished: aiOutput.finished,
        text: aiOutput.text,
        response,
        timings: aiOutput.timings,
        performance: aiOutput.performance,
        usage: aiOutput.usage,
      },
      execution: details?.execution,
      engine: details?.engine,
      threadId: details?.threadId,
      codexTurnId: details?.codexTurnId,
      modelRequestId: details?.modelRequestId,
      ...(details?.truncated === true ? {
        truncated: true,
        originalCharacters: details.originalCharacters,
      } : {}),
    });
    return compactedDetails.length < log.details.length
      ? { ...log, details: compactedDetails }
      : log;
  } catch {
    return log;
  }
}

export function compactBrowserChatLogsForClient<TLog extends BrowserChatClientLog>(logs: TLog[]) {
  const compacted = logs.map(compactBrowserChatLogForClient);
  const finalToolLogIndex = new Map<string, number>();
  const finalToolLogKey = (log: TLog) => {
    const isFinalToolLog = (log.phase === 'ai:tool' || log.phase.endsWith(':ai:tool'))
      && Boolean(log.toolCallId)
      && /\s->\s(?:ok|failed|completed)$/i.test(log.message || '');
    return isFinalToolLog
      ? [log.phase, log.toolCallId, log.stepIndex ?? '', log.message].join('|')
      : undefined;
  };
  compacted.forEach((log, index) => {
    const key = finalToolLogKey(log);
    if (key) finalToolLogIndex.set(key, index);
  });
  return compacted.filter((log, index) => {
    const key = finalToolLogKey(log);
    return !key || finalToolLogIndex.get(key) === index;
  });
}

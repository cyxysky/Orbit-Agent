export type BrowserChatActivity = { phase: string; label: string; updatedAt: string; startedAt?: string; operationId?: string };

function operationKind(phase: string, previous?: BrowserChatActivity) {
  if (phase.startsWith('tool:') || phase === 'ai:tool') return 'tool';
  if (phase.startsWith('browser:') && previous?.operationId?.startsWith('tool:')) return 'tool';
  if (phase.startsWith('ai:context-compression:')) return 'compression';
  if (/^ai:(?:text:|runtime:(?:request|dispatch|response|receiving|object))/.test(phase)) return 'ai';
  return previous?.operationId?.split(':', 1)[0] || 'preparing';
}

/** updatedAt is a heartbeat; it must never become the elapsed-time origin. */
export function nextBrowserChatActivity(input: {
  phase: string; label: string; timestamp: string; elapsedMs?: number; operationId?: string; previous?: BrowserChatActivity;
}): BrowserChatActivity {
  const kind = operationKind(input.phase, input.previous);
  const sameKind = input.previous && operationKind(input.previous.phase, input.previous) === kind;
  const operationId = input.operationId
    || (sameKind ? input.previous?.operationId : undefined)
    || `${kind}:${input.timestamp}`;
  const sameOperation = input.previous?.operationId
    ? input.previous.operationId === operationId
    : sameKind && !input.operationId;
  // Heartbeats preserve one operation's origin; the next request/tool starts its own clock.
  const startedAt = (sameOperation ? input.previous?.startedAt || input.previous?.updatedAt : undefined)
    || (typeof input.elapsedMs === 'number' && Number.isFinite(input.elapsedMs)
      ? new Date(Date.parse(input.timestamp) - Math.max(0, input.elapsedMs)).toISOString()
      : input.timestamp);
  return { phase: input.phase, label: input.label, updatedAt: input.timestamp, startedAt, operationId };
}

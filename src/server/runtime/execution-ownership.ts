export type ExecutionTask = { kind: 'chat' | 'automation'; id: string; turnId?: string };

let browserChatOwner: ((sessionId: string) => boolean) | undefined;

export function setBrowserChatExecutionOwner(lookup: (sessionId: string) => boolean) {
  browserChatOwner = lookup;
}

export function browserChatExecutionIsActive(sessionId: string) {
  return browserChatOwner?.(sessionId);
}

export function reportExecutionTask(task: ExecutionTask, active: boolean) {
  if (process.env.WEBPILOT_SERVER_ROLE !== 'execution' || !process.connected) return;
  process.send?.({ type: 'execution-task', task, active }, () => undefined);
}

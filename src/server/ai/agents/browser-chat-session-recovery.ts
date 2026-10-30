import type { BrowserChatTurnState } from '@/server/ai/agents/browser-chat-session-state';
import type { BrowserChatSubagentRecord } from '@/server/ai/schemas/runtime.schema';
import { browserChatExecutionIsActive } from '@/server/runtime/execution-ownership';

type RecoverableBrowserChatSession = {
  id: string;
  busy: boolean;
  status: 'idle' | 'running' | 'closed' | 'error';
  turnState?: BrowserChatTurnState;
  pendingToolConfirmation?: unknown;
  subagents?: BrowserChatSubagentRecord[];
  messages?: Array<{ id: string; status?: string; updatedAt?: string }>;
};

type BrowserChatChildRuntime = {
  sessionId: string;
  assistantMessageId: string;
  abortController?: AbortController;
};

type BrowserChatRuntimeRegistry = {
  activeTurns?: Pick<Map<string, unknown>, 'has'>;
  activeSubagents?: Pick<Map<string, BrowserChatChildRuntime>, 'get' | 'values'>;
  blockedSubagents?: Pick<Map<string, BrowserChatChildRuntime>, 'get' | 'values'>;
  sessions?: Pick<Map<string, {
    turnState?: BrowserChatTurnState;
    browser?: { isUsable?: () => boolean };
  }>, 'get'>;
};

const browserChatRuntimeGlobal = globalThis as typeof globalThis & {
  __browserChatRuntimeState?: BrowserChatRuntimeRegistry;
};

const orphanedSubagentReason = '上次子 Agent 执行已中断，当前进程没有可继续的运行任务；已保留此前结果和工具记录。';
const expiredSubagentPageReason = '此前的子 Agent 人工处理页面已失效，无法从该暂停点继续；已保留此前结果和工具记录。';

function hasActiveBrowserChatTurn(sessionId: string) {
  // The API's local Agent registry is empty by design. Consult its supervisor's
  // IPC ownership instead of falsely turning live sessions into orphaned ones.
  if (process.env.WEBPILOT_SERVER_ROLE === 'api') return browserChatExecutionIsActive(sessionId) ?? true;
  const runtime = browserChatRuntimeGlobal.__browserChatRuntimeState;
  if (runtime?.activeTurns?.has(sessionId)) return true;
  if ([...(runtime?.activeSubagents?.values() || [])].some(child => child.sessionId === sessionId
    && !child.abortController?.signal.aborted)) return true;
  if ([...(runtime?.blockedSubagents?.values() || [])].some(child => child.sessionId === sessionId)) return true;
  const session = runtime?.sessions?.get(sessionId);
  return session?.turnState === 'awaiting_human' && session.browser?.isUsable?.() === true;
}

function recoverOrphanedSubagent(sessionId: string, child: BrowserChatSubagentRecord) {
  if (process.env.WEBPILOT_SERVER_ROLE === 'api' && (browserChatExecutionIsActive(sessionId) ?? true)) return child;
  const runtime = process.env.WEBPILOT_SERVER_ROLE === 'api' ? undefined : browserChatRuntimeGlobal.__browserChatRuntimeState;
  const active = runtime?.activeSubagents?.get(child.id);
  const binding = runtime?.blockedSubagents?.get(child.id);
  const ownsActive = active?.sessionId === sessionId && active.assistantMessageId === child.messageId
    && !active.abortController?.signal.aborted;
  const ownsBinding = binding?.sessionId === sessionId && binding.assistantMessageId === child.messageId;
  if (ownsActive || ownsBinding) {
    const resumable = child.status === 'blocked' && ownsBinding;
    return child.resumable === resumable ? child : { ...child, resumable };
  }
  const reason = child.status === 'queued' || child.status === 'running'
    ? orphanedSubagentReason
    : child.status === 'blocked' && child.resumable
      ? expiredSubagentPageReason
      : undefined;
  if (!reason) return child.resumable ? { ...child, resumable: false } : child;
  return {
    ...child,
    status: child.status === 'queued' || child.status === 'running' ? 'failed' as const : child.status,
    resumable: false,
    currentAction: undefined,
    updatedAt: new Date().toISOString(),
    error: child.error ? `${child.error}\n\n${reason}` : reason,
  };
}

export function recoverOrphanedBrowserChatSession<T extends RecoverableBrowserChatSession>(
  persistedSummary: T,
): T {
  const subagents = persistedSummary.subagents?.map(child => recoverOrphanedSubagent(persistedSummary.id, child));
  const childrenChanged = subagents?.some((child, index) => child !== persistedSummary.subagents?.[index]) === true;
  const affectedMessageIds = new Set(subagents?.flatMap(child => child.error?.includes(orphanedSubagentReason)
    || child.error?.includes(expiredSubagentPageReason) ? [child.messageId] : []) || []);
  const orphanedChild = childrenChanged && subagents?.some((child, index) => {
    const previous = persistedSummary.subagents?.[index];
    return child !== previous && (previous?.status === 'queued' || previous?.status === 'running'
      || (previous?.status === 'blocked' && previous.resumable));
  });
  const persistedLifecycleNeedsReview = persistedSummary.busy
    || persistedSummary.status === 'running'
    || persistedSummary.turnState === 'interrupted'
    || persistedSummary.turnState === 'awaiting_human'
    || orphanedChild;
  if (!persistedLifecycleNeedsReview || hasActiveBrowserChatTurn(persistedSummary.id)) {
    return childrenChanged ? { ...persistedSummary, subagents } : persistedSummary;
  }
  return {
    ...persistedSummary,
    ...(childrenChanged ? { subagents } : {}),
    ...(persistedSummary.messages && affectedMessageIds.size ? {
      messages: persistedSummary.messages.map(message => affectedMessageIds.has(message.id)
        && ['blocked', 'running', 'queued'].includes(message.status || '')
        ? { ...message, status: 'interrupted', updatedAt: new Date().toISOString() } : message),
    } : {}),
    busy: false,
    status: persistedSummary.status === 'closed' ? 'closed' : 'idle',
    turnState: persistedSummary.status === 'closed' ? 'closed' : 'interrupted',
    pendingToolConfirmation: undefined,
  };
}

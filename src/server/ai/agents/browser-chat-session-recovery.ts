import type { BrowserChatTurnState } from '@/server/ai/agents/browser-chat-session-state';
import { browserChatExecutionIsActive } from '@/server/runtime/execution-ownership';

type RecoverableBrowserChatSession = {
  id: string;
  busy: boolean;
  status: 'idle' | 'running' | 'closed' | 'error';
  turnState?: BrowserChatTurnState;
  pendingToolConfirmation?: unknown;
};

type BrowserChatRuntimeRegistry = {
  activeTurns?: Pick<Map<string, unknown>, 'has'>;
};

const browserChatRuntimeGlobal = globalThis as typeof globalThis & {
  __browserChatRuntimeState?: BrowserChatRuntimeRegistry;
};

function hasActiveBrowserChatTurn(sessionId: string) {
  // The API's local Agent registry is empty by design. Consult its supervisor's
  // IPC ownership instead of falsely turning live sessions into orphaned ones.
  if (process.env.WEBPILOT_SERVER_ROLE === 'api') return browserChatExecutionIsActive(sessionId) ?? true;
  return browserChatRuntimeGlobal.__browserChatRuntimeState?.activeTurns?.has(sessionId) === true;
}

export function recoverOrphanedBrowserChatSession<T extends RecoverableBrowserChatSession>(
  persistedSummary: T,
): T {
  const persistedLifecycleNeedsReview = persistedSummary.busy
    || persistedSummary.status === 'running'
    || persistedSummary.turnState === 'interrupted';
  if (!persistedLifecycleNeedsReview || hasActiveBrowserChatTurn(persistedSummary.id)) {
    return persistedSummary;
  }
  return {
    ...persistedSummary,
    busy: false,
    status: 'idle',
    turnState: 'interrupted',
    pendingToolConfirmation: undefined,
  };
}

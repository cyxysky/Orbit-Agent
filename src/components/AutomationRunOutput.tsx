'use client';

import { BrowserChatAutomationRunIdContext, BrowserChatOrderedResponse } from '@/components/BrowserChatMarkdown';
import type { BrowserChatUIMessagePart } from '@/lib/browser-chat-ui-message';

/** Load rich document/chart renderers only when an automation result is displayed. */
export function AutomationRunOutput({ runId, fallbackText, parts }: {
  runId: string; fallbackText: string; parts: BrowserChatUIMessagePart[];
}) {
  return <BrowserChatAutomationRunIdContext.Provider value={runId}>
    <BrowserChatOrderedResponse fallbackText={fallbackText} parts={parts} />
  </BrowserChatAutomationRunIdContext.Provider>;
}

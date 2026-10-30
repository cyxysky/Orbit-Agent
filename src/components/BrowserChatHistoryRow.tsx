'use client';

import type { ReactNode } from 'react';

/** Keep React state intact and let the browser invalidate visibility with layout. */
export function BrowserChatHistoryRow({ children, keepMounted, turnId }: {
  children: ReactNode;
  keepMounted: boolean;
  turnId?: string;
}) {
  return <div
    className="browser-chat-history-row"
    data-browser-chat-turn-anchor={turnId}
    style={keepMounted ? { contentVisibility: 'visible' } : {
      contentVisibility: 'auto', containIntrinsicBlockSize: 'auto 160px',
    }}
  >{children}</div>;
}

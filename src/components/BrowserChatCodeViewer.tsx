'use client';

import type { ReactNode } from 'react';

function highlightedPayloadLine(line: string, lineIndex: number): ReactNode[] {
  const tokenPattern = /("(?:\\.|[^"\\])*")(?=\s*:)|("(?:\\.|[^"\\])*")|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|\b(true|false|null)\b/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(line)) !== null) {
    if (match.index > cursor) nodes.push(line.slice(cursor, match.index));
    const tone = match[1]
      ? 'key'
      : match[2]
        ? 'string'
        : match[3]
          ? 'number'
          : match[4] === 'null'
            ? 'null'
            : 'boolean';
    nodes.push(
      <span className={`browser-chat-tool-code-token is-${tone}`} key={`${lineIndex}-${match.index}`}>
        {match[0]}
      </span>,
    );
    cursor = match.index + match[0].length;
  }

  if (cursor < line.length) nodes.push(line.slice(cursor));
  return nodes.length ? nodes : [' '];
}

export function BrowserChatCodeViewer({ payload, wrap }: { payload: string; wrap: boolean }) {
  return (
    <div className={`browser-chat-tool-output-viewer${wrap ? ' is-wrapped' : ''}`} role="region" tabIndex={0}>
      <div className="browser-chat-tool-output-code">
        {payload.split('\n').map((line, index) => (
          <div className="browser-chat-tool-output-line" key={`${index}-${line}`}>
            <span aria-hidden="true" className="browser-chat-tool-output-line-number">{index + 1}</span>
            <code>{highlightedPayloadLine(line, index)}</code>
          </div>
        ))}
      </div>
    </div>
  );
}


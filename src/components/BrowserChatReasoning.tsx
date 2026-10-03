'use client';

import { useEffect, useRef, useState } from 'react';
import { Brain, ChevronDown } from 'lucide-react';

export function BrowserChatReasoning({ text, streaming, running = streaming, label }: { text: string; streaming: boolean; running?: boolean; label: string }) {
  const phase = streaming ? 'streaming' : running ? 'responding' : 'complete';
  const [disclosure, setDisclosure] = useState({ phase, open: streaming });
  // A completed stream/answer closes even a manually expanded section. Users
  // can reopen it afterwards; subsequent text renders preserve their choice.
  if (disclosure.phase !== phase) setDisclosure({ phase, open: streaming });
  const body = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const lastScrollTop = useRef(0);
  const lastTouchY = useRef<number | undefined>(undefined);
  const open = disclosure.phase === phase ? disclosure.open : streaming;
  useEffect(() => {
    const element = body.current;
    if (!streaming || !open || !element) return;
    // A streamed update can arrive before the user's scroll event is delivered.
    if (element.scrollTop < lastScrollTop.current - 0.5
      && element.scrollHeight - element.clientHeight - element.scrollTop > 1) follow.current = false;
    if (follow.current) {
      element.scrollTop = element.scrollHeight;
      lastScrollTop.current = element.scrollTop;
    }
  }, [text, streaming, open]);
  return <details className={`browser-chat-ai-line-collapse browser-chat-reasoning${streaming ? ' is-streaming' : ''}`} open={open}>
    <summary className="browser-chat-ai-collapse-summary" onClick={event => {
      event.preventDefault();
      setDisclosure({ phase, open: !open });
    }}>
      <span className="browser-chat-tool-icon" aria-hidden="true"><Brain size={16} /></span>
      <span>{label}</span>
      <ChevronDown className="browser-chat-ai-tool-chevron" size={12} aria-hidden="true" />
    </summary>
    <div className="browser-chat-ai-reasoning-text" ref={body} aria-busy={streaming} onWheel={event => {
      const element = event.currentTarget;
      if (event.ctrlKey) return;
      if (event.deltaY < 0 && element.scrollHeight > element.clientHeight + 1) follow.current = false;
      else if (event.deltaY > 0 && element.scrollHeight - element.clientHeight - element.scrollTop <= 1) follow.current = true;
    }} onTouchStart={event => {
      lastTouchY.current = event.touches[0]?.clientY;
    }} onTouchMove={event => {
      const touchY = event.touches[0]?.clientY;
      const element = event.currentTarget;
      if (touchY !== undefined && lastTouchY.current !== undefined && touchY > lastTouchY.current
        && element.scrollHeight > element.clientHeight + 1) follow.current = false;
      lastTouchY.current = touchY;
    }} onScroll={event => {
      const element = event.currentTarget;
      const distanceFromBottom = element.scrollHeight - element.clientHeight - element.scrollTop;
      if (element.scrollTop < lastScrollTop.current - 0.5 && distanceFromBottom > 1) follow.current = false;
      else if (distanceFromBottom <= 1) follow.current = true;
      lastScrollTop.current = element.scrollTop;
    }}><p>{text}</p></div>
  </details>;
}

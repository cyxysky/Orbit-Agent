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
  const open = disclosure.phase === phase ? disclosure.open : streaming;
  useEffect(() => {
    if (streaming && open && follow.current && body.current) body.current.scrollTop = body.current.scrollHeight;
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
    <div className="browser-chat-ai-reasoning-text" ref={body} aria-busy={streaming} onScroll={event => {
      const element = event.currentTarget;
      follow.current = element.scrollHeight - element.clientHeight - element.scrollTop < 28;
    }}><p>{text}</p></div>
  </details>;
}

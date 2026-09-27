'use client';

import { useEffect, useRef, useState } from 'react';
import type { HTMLResponseParams } from './index.ts';
import { createHTMLResponseDocument, HTML_FRAME_MESSAGE, HTML_FRAME_SANDBOX } from './html-document.ts';

const themeProperties = ['--foreground', '--muted', '--panel', '--border', '--accent', '--accent-strong', '--app-font-sans'];

export function HTMLResponseView({ params, locale }: { params: HTMLResponseParams; locale: string }) {
  const { html, css, title, text } = params;
  const container = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [source, setSource] = useState('');
  const [height, setHeight] = useState(240);

  useEffect(() => {
    let nonce = '';
    const prepare = () => {
      if (!container.current) return;
      nonce = crypto.randomUUID().replaceAll('-', '');
      const computed = getComputedStyle(container.current);
      const theme = Object.fromEntries(themeProperties.map(name => [name, computed.getPropertyValue(name).trim()]).filter(([, value]) => value));
      theme['color-scheme'] = computed.colorScheme;
      setSource(createHTMLResponseDocument({ html, css, title, text }, { nonce, baseURL: window.location.href, locale, theme }));
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== HTML_FRAME_MESSAGE || event.data?.nonce !== nonce) return;
      if (typeof event.data.height !== 'number' || !Number.isFinite(event.data.height)) return;
      // The conversation owns scrolling; the embedded document grows with its content.
      setHeight(Math.max(48, Math.ceil(event.data.height)));
    };
    window.addEventListener('message', onMessage);
    prepare();
    const themeObserver = new MutationObserver(prepare);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    return () => {
      window.removeEventListener('message', onMessage);
      themeObserver.disconnect();
    };
  }, [html, css, title, text, locale]);

  return <div ref={container} className="capability-response-html" style={{ minWidth: 0 }}>
    {source ? <iframe
      ref={frame}
      title={params.title}
      sandbox={HTML_FRAME_SANDBOX}
      referrerPolicy="no-referrer"
      srcDoc={source}
      style={{ display: 'block', width: '100%', height, border: 0, background: 'transparent', colorScheme: 'normal' }}
    /> : <div style={{ whiteSpace: 'pre-wrap' }}>{params.text}</div>}
  </div>;
}

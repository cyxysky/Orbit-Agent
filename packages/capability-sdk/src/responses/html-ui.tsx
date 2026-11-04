'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import type { HTMLResponseParams } from './index.ts';
import { createHTMLResponseDocument, HTML_FRAME_MESSAGE, HTML_FRAME_SANDBOX, HTML_FRAME_THEME_MESSAGE, HTML_FRAME_THEME_PROPERTIES } from './html-document.ts';
import { RESPONSE_LAYOUT_EVENT } from './layout.ts';

export function HTMLResponseView({ params, locale }: { params: HTMLResponseParams; locale: string }) {
  const { html, css, title, text } = params;
  const container = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [source, setSource] = useState<{ document: string; nonce: string }>();
  const [measurement, setMeasurement] = useState<{ nonce: string; height: number; ready: boolean }>();
  const [failedNonce, setFailedNonce] = useState('');
  const syncTheme = useRef<() => void>(() => {}), fail = useRef<() => void>(() => {});
  const ready = Boolean(source && measurement?.nonce === source.nonce && measurement.ready);
  const failed = Boolean(source && failedNonce === source.nonce);
  const height = measurement?.height ?? 240;

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const nonce = crypto.randomUUID().replaceAll('-', '');
    const readTheme = () => {
      const computed = getComputedStyle(element);
      const theme = Object.fromEntries(HTML_FRAME_THEME_PROPERTIES.map(name => [name, computed.getPropertyValue(name).trim()]).filter(([, value]) => value));
      theme['color-scheme'] = computed.colorScheme;
      return theme;
    };
    const theme = readTheme();
    let themeKey = JSON.stringify(theme);
    const updateTheme = (force = false) => {
      const next = readTheme(), key = JSON.stringify(next);
      if (!force && key === themeKey) return;
      themeKey = key;
      frame.current?.contentWindow?.postMessage({ type: HTML_FRAME_THEME_MESSAGE, nonce, theme: next }, '*');
    };
    syncTheme.current = () => updateTheme(true);
    const timer = window.setTimeout(() => setFailedNonce(nonce), 10_000);
    fail.current = () => { window.clearTimeout(timer); setFailedNonce(nonce); };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== HTML_FRAME_MESSAGE || event.data?.nonce !== nonce) return;
      if (typeof event.data.height !== 'number' || !Number.isFinite(event.data.height) || typeof event.data.ready !== 'boolean') return;
      if (event.data.ready) window.clearTimeout(timer);
      // The conversation owns scrolling; the embedded document grows with its content.
      const nextHeight = Math.max(48, Math.ceil(event.data.height));
      setMeasurement(previous => previous?.nonce === nonce && previous.height === nextHeight && previous.ready === event.data.ready
        ? previous : { nonce, height: nextHeight, ready: event.data.ready });
    };
    window.addEventListener('message', onMessage);
    setSource({ document: createHTMLResponseDocument({ html, css, title, text }, { nonce, baseURL: window.location.href, locale, theme }), nonce });
    const themeObserver = new MutationObserver(() => updateTheme());
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    return () => {
      window.removeEventListener('message', onMessage);
      themeObserver.disconnect();
      window.clearTimeout(timer);
      syncTheme.current = () => {}; fail.current = () => {};
    };
  }, [html, css, title, text, locale]);

  useLayoutEffect(() => {
    container.current?.dispatchEvent(new Event(RESPONSE_LAYOUT_EVENT, { bubbles: true }));
  }, [source, height, ready, failed]);

  return <div ref={container} className="capability-response-html" data-capability-response-layout={failed ? 'error' : ready ? 'ready' : 'pending'} aria-busy={!ready && !failed} style={{ minWidth: 0 }}>
    {failed ? <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{params.text}</div> : source ? <iframe
      ref={frame}
      title={params.title}
      sandbox={HTML_FRAME_SANDBOX}
      referrerPolicy="no-referrer"
      srcDoc={source.document}
      onLoad={() => syncTheme.current()}
      onError={() => fail.current()}
      style={{ display: 'block', width: '100%', height, visibility: ready ? 'visible' : 'hidden', border: 0, background: 'transparent', colorScheme: 'inherit' }}
    /> : <div aria-hidden="true" style={{ minHeight: height }} />}
  </div>;
}

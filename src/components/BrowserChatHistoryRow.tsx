'use client';

import { Activity, useEffect, useRef, useState, type ReactNode } from 'react';

type VisibilitySubscription = (entry: IntersectionObserverEntry) => void;
const viewportObservers = new WeakMap<Element | Document, {
  observer: IntersectionObserver; subscriptions: Map<Element, VisibilitySubscription>;
}>();

function observeRow(node: HTMLElement, notify: VisibilitySubscription) {
  const root = node.parentElement?.closest('.browser-chat-message-list') || null;
  const key = root || node.ownerDocument;
  let shared = viewportObservers.get(key);
  if (!shared) {
    const subscriptions = new Map<Element, VisibilitySubscription>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) subscriptions.get(entry.target)?.(entry);
    }, { root, rootMargin: '900px 0px' });
    shared = { observer, subscriptions };
    viewportObservers.set(key, shared);
  }
  shared.subscriptions.set(node, notify);
  shared.observer.observe(node);
  return () => {
    shared.observer.unobserve(node);
    shared.subscriptions.delete(node);
    if (!shared.subscriptions.size) { shared.observer.disconnect(); viewportObservers.delete(key); }
  };
}

/** Preserve state and measured scroll space while suspending offscreen React work. */
export function BrowserChatHistoryRow({ children, keepMounted, turnId }: {
  children: ReactNode;
  keepMounted: boolean;
  turnId?: string;
}) {
  const node = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ visible: true, height: 0 });
  const visible = keepMounted || viewport.visible;
  useEffect(() => {
    const element = node.current;
    if (keepMounted) { setViewport(current => current.visible ? current : { ...current, visible: true }); return; }
    if (!element) return;
    return observeRow(element, entry => {
      const selection = element.ownerDocument.getSelection();
      const selected = selection && !selection.isCollapsed && Array.from({ length: selection.rangeCount },
        (_, index) => selection.getRangeAt(index)).some(range => range.intersectsNode(element));
      const nextVisible = entry.isIntersecting || element.contains(element.ownerDocument.activeElement) || Boolean(selected);
      setViewport(current => current.visible === nextVisible ? current
        : { visible: nextVisible, height: entry.boundingClientRect.height });
    });
  }, [keepMounted]);
  return <div
    ref={node}
    className="browser-chat-history-row"
    data-browser-chat-turn-anchor={turnId}
    data-history-suspended={!visible || undefined}
    style={!visible ? { height: viewport.height } : keepMounted ? { contentVisibility: 'visible' } : {
      contentVisibility: 'auto', containIntrinsicBlockSize: 'auto 160px',
    }}
  ><Activity mode={visible ? 'visible' : 'hidden'}>{children}</Activity></div>;
}

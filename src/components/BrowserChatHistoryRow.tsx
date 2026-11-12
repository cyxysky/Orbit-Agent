'use client';

import { Activity, useEffect, useRef, useState, type ReactNode } from 'react';
import { RESPONSE_LAYOUT_EVENT, RESPONSE_LAYOUT_PENDING_SELECTOR } from '@cjfclonedeep/capability-sdk/responses/react';

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
    let nearViewport = true;
    let frame = 0;
    let disposed = false;
    let measuredWidth = 0;
    const reconcile = () => {
      frame = 0;
      if (disposed || (!nearViewport && element.dataset.historySuspended === 'true')) return;
      const selection = element.ownerDocument.getSelection();
      const selected = selection && !selection.isCollapsed && Array.from({ length: selection.rangeCount },
        (_, index) => selection.getRangeAt(index)).some(range => range.intersectsNode(element));
      const nextVisible = nearViewport || element.contains(element.ownerDocument.activeElement) || Boolean(selected);
      // Estimate-free suspension: hiding an unresolved frame/chart/image stores
      // its loading height, which changes the scroll range when it wakes up.
      let imagesPending = false;
      for (const image of element.querySelectorAll('img')) {
        if (image.complete || (Number(image.getAttribute('width')) > 0 && Number(image.getAttribute('height')) > 0)) continue;
        imagesPending = true;
        // An unknown intrinsic size must be loaded before freezing this row;
        // otherwise native lazy loading waits until the reader scrolls to it.
        if (!nextVisible) image.loading = 'eager';
      }
      if (imagesPending || element.querySelector(`${RESPONSE_LAYOUT_PENDING_SELECTOR}, [aria-busy="true"]`)
        || element.ownerDocument.fonts.status === 'loading') return;
      const height = nextVisible ? 0 : element.getBoundingClientRect().height;
      setViewport(current => current.visible === nextVisible && current.height === height ? current : { visible: nextVisible, height });
    };
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      // Let React commit resource readiness and the resulting layout before
      // taking the one height that Activity will preserve offscreen.
      frame = requestAnimationFrame(() => { frame = requestAnimationFrame(reconcile); });
    };
    const unobserve = observeRow(element, entry => {
      nearViewport = entry.isIntersecting;
      if (nearViewport) setViewport(current => current.visible ? current : { ...current, visible: true });
      schedule();
    });
    const resizeObserver = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (measuredWidth && Math.abs(width - measuredWidth) > 0.5) {
        // A frozen height only belongs to its measured width. Reflow hidden
        // Markdown/frames now, rather than during the next upward scroll.
        setViewport(current => current.visible && !current.height ? current : { visible: true, height: 0 });
      }
      measuredWidth = width;
      schedule();
    });
    resizeObserver.observe(element);
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(element, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['data-capability-response-layout', 'aria-busy'],
    });
    element.addEventListener('load', schedule, true);
    element.addEventListener('error', schedule, true);
    element.addEventListener(RESPONSE_LAYOUT_EVENT, schedule);
    void element.ownerDocument.fonts.ready.then(() => { if (!disposed) schedule(); });
    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      unobserve();
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      element.removeEventListener('load', schedule, true);
      element.removeEventListener('error', schedule, true);
      element.removeEventListener(RESPONSE_LAYOUT_EVENT, schedule);
    };
  }, [keepMounted]);
  return <div
    ref={node}
    className="browser-chat-history-row"
    data-browser-chat-turn-anchor={turnId}
    data-history-suspended={!visible || undefined}
    style={{ contentVisibility: 'visible', ...(!visible ? { height: viewport.height } : !keepMounted && viewport.height ? { minHeight: viewport.height } : {}) }}
  ><Activity mode={visible ? 'visible' : 'hidden'}>{children}</Activity></div>;
}

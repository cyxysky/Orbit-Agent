export type ScrollAnchor = Array<{ element: Element; textOffset?: number; top: number }>;

/** Remember visible content, rather than total scrollHeight: loading below the
 * viewport must not move the reader, while loading above it needs compensation. */
export function captureScrollAnchor(container: HTMLElement): ScrollAnchor {
  const bounds = container.getBoundingClientRect();
  const anchors: ScrollAnchor = [];
  const x = Math.min(bounds.right - 24, bounds.left + Math.max(24, container.clientWidth / 3));
  for (const y of [bounds.top + 28, bounds.top + Math.min(container.clientHeight / 2, 180)]) {
    const element = container.ownerDocument.elementFromPoint(x, y);
    if (!element || element === container || !container.contains(element)) continue;
    const row = element.closest('.browser-chat-history-row') || element;
    const range = container.ownerDocument.caretRangeFromPoint?.(x, y);
    if (range && container.contains(range.startContainer) && range.startContainer.nodeType === Node.TEXT_NODE) {
      const block = range.startContainer.parentElement?.closest('p, li, pre, h1, h2, h3, h4, h5, h6') || element;
      const prefix = container.ownerDocument.createRange();
      prefix.selectNodeContents(block);
      prefix.setEnd(range.startContainer, range.startOffset);
      const textOffset = prefix.toString().length;
      if (range.startOffset < (range.startContainer.textContent?.length || 0)) range.setEnd(range.startContainer, range.startOffset + 1);
      const rect = range.getClientRects()[0];
      if (rect) anchors.push({ element: block, textOffset, top: rect.top - bounds.top });
    }
    if (!anchors.some(anchor => anchor.element === element && anchor.textOffset === undefined)) anchors.push({ element, top: element.getBoundingClientRect().top - bounds.top });
    if (row !== element && !anchors.some(anchor => anchor.element === row)) anchors.push({ element: row, top: row.getBoundingClientRect().top - bounds.top });
  }
  return anchors;
}

export function restoreScrollAnchor(container: HTMLElement, anchors: ScrollAnchor) {
  const bounds = container.getBoundingClientRect();
  for (const anchor of anchors) {
    if (!anchor.element.isConnected || !container.contains(anchor.element)) continue;
    let rect: DOMRect | undefined;
    if (anchor.textOffset !== undefined) {
      // Live Range offsets reset when React replaces text or wraps inline
      // Markdown. Store an immutable character offset and resolve it anew.
      const walker = container.ownerDocument.createTreeWalker(anchor.element, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode(), remaining = anchor.textOffset;
      while (node) {
        const length = node.textContent?.length || 0;
        if (remaining <= length) {
          const range = container.ownerDocument.createRange();
          range.setStart(node, remaining); range.setEnd(node, Math.min(length, remaining + 1));
          rect = range.getClientRects()[0]; break;
        }
        remaining -= length; node = walker.nextNode();
      }
      if (!rect) continue;
    }
    const delta = (rect || anchor.element.getBoundingClientRect()).top - bounds.top - anchor.top;
    if (Math.abs(delta) > 0.5) container.scrollTop += delta;
    return;
  }
}

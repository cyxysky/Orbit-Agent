'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Animate to the label's real width, including changes in language or font. */
export function ExpandableActionLabel({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;
    const measure = () => container.style.setProperty('--action-label-width', `${content.offsetWidth}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return <span aria-hidden="true" className="ui-expandable-action-label" ref={containerRef}>
    <span ref={contentRef}>{children}</span>
  </span>;
}

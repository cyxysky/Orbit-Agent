'use client';

import { Skeleton } from '@heroui/react/skeleton';
import { startTransition, useEffect, useRef, useState, type ReactNode } from 'react';

/** Mount expensive content near the viewport once; keep its state after scrolling away. */
export function DeferredContent({ children, className, estimatedHeight, label }: {
  children: ReactNode;
  className?: string;
  estimatedHeight: number;
  label: string;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const target = element.current;
    if (!target) return;
    if (typeof IntersectionObserver === 'undefined') { setReady(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      startTransition(() => setReady(true));
    }, { rootMargin: '120px 0px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  return <div aria-busy={!ready} className={className} ref={element}>
    {ready ? children : <div role="status" aria-label={label} style={{ gridColumn: '1 / -1', minHeight: estimatedHeight }}>
      <span className="sr-only">{label}</span>
      <Skeleton style={{ width: '100%', minHeight: estimatedHeight }} />
    </div>}
  </div>;
}

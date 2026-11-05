'use client';

import { useEffect, useRef, useState } from 'react';

/** Smooth transport bursts without retaining a token queue or replaying history. */
export function useStreamingText(text: string, streaming: boolean) {
  const [displayed, setDisplayed] = useState(text);
  const shown = useRef(text);
  const target = useRef(text);
  const frame = useRef(0);
  const receivedAt = useRef(0);
  const previousFrame = useRef(0);
  const allowed = useRef(false);

  useEffect(() => {
    if (!streaming) { allowed.current = false; return; }
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncPreference = () => {
      allowed.current = !preference.matches && document.visibilityState !== 'hidden';
      if (!allowed.current) {
        cancelAnimationFrame(frame.current);
        frame.current = 0;
        shown.current = target.current;
        setDisplayed(target.current);
      }
    };
    syncPreference();
    preference.addEventListener('change', syncPreference);
    document.addEventListener('visibilitychange', syncPreference);
    return () => {
      preference.removeEventListener('change', syncPreference);
      document.removeEventListener('visibilitychange', syncPreference);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [streaming]);

  useEffect(() => {
    target.current = text;
    receivedAt.current = performance.now();
    if (!streaming || !allowed.current || !text.startsWith(shown.current)) {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      shown.current = text;
      setDisplayed(text);
      return;
    }
    if (frame.current || shown.current === text) return;
    previousFrame.current = performance.now();
    const advance = (now: number) => {
      frame.current = 0;
      const latest = target.current;
      const remaining = latest.length - shown.current.length;
      const elapsed = Math.min(32, Math.max(8, now - previousFrame.current));
      const count = now - receivedAt.current >= 100 ? remaining
        : Math.max(1, remaining - 256, Math.ceil(remaining * elapsed / 60));
      let end = Math.min(latest.length, shown.current.length + count);
      // Never paint half an emoji at the reveal boundary.
      if (end < latest.length && /[\uD800-\uDBFF]/.test(latest[end - 1]) && /[\uDC00-\uDFFF]/.test(latest[end])) end++;
      shown.current = latest.slice(0, end);
      setDisplayed(shown.current);
      previousFrame.current = now;
      if (end < latest.length) frame.current = requestAnimationFrame(advance);
    };
    frame.current = requestAnimationFrame(advance);
  }, [streaming, text]);

  // Completion, replacement and stop never leave a final tail hidden.
  return streaming && text.startsWith(displayed) ? displayed : text;
}

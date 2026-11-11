'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Pace incoming bursts within a bounded window. Keep just the latest snapshot,
 * leave mounted history intact, and finish a live tail without a final jump. */
export function useStreamingText(text: string, streaming: boolean) {
  const [displayed, setDisplayed] = useState(text);
  const active = streaming || displayed !== text;
  const state = useRef({
    shown: text, target: text, streaming, frame: 0, deadline: 0,
    previousFrame: 0, allowed: false,
  });

  useEffect(() => {
    const current = state.current;
    if (!active) { current.allowed = false; return; }
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncPreference = () => {
      current.allowed = !preference.matches && document.visibilityState !== 'hidden';
      if (!current.allowed) {
        cancelAnimationFrame(current.frame);
        current.frame = 0;
        current.shown = current.target;
        setDisplayed(current.target);
      }
    };
    syncPreference();
    preference.addEventListener('change', syncPreference);
    document.addEventListener('visibilitychange', syncPreference);
    return () => {
      preference.removeEventListener('change', syncPreference);
      document.removeEventListener('visibilitychange', syncPreference);
      cancelAnimationFrame(current.frame);
      current.frame = 0;
      current.allowed = false;
    };
  }, [active]);

  useLayoutEffect(() => {
    const current = state.current;
    const added = Math.max(0, text.length - current.target.length);
    const wasStreaming = current.streaming;
    current.target = text;
    current.streaming = streaming;
    if (!current.allowed || !text.startsWith(current.shown)
      || (!streaming && !wasStreaming && !current.frame)) {
      cancelAnimationFrame(current.frame);
      current.frame = 0;
      current.shown = text;
      setDisplayed(text);
      return;
    }
    if (current.shown === text) return;
    const now = performance.now();
    // Small packets stay responsive; larger bursts are spread across frames
    // rather than dumping everything except a fixed 256-character tail.
    if (added) current.deadline = now + Math.min(320, Math.max(80, Math.sqrt(added) * 12));
    if (!streaming) current.deadline = Math.min(current.deadline, now + 120);
    if (current.frame) return;
    current.previousFrame = now;
    const advance = (now: number) => {
      current.frame = 0;
      const remaining = current.target.length - current.shown.length;
      const elapsed = now - current.previousFrame;
      const remainingTime = Math.max(1, current.deadline - current.previousFrame);
      const count = Math.floor(remaining * Math.min(1, elapsed / remainingTime));
      if (count > 0) {
        let end = Math.min(current.target.length, current.shown.length + count);
        if (end < current.target.length) {
          // A grapheme may include skin tones, a flag, combining marks or ZWJ
          // sequences; protecting only surrogate pairs still tears these apart.
          const offset = current.shown.length;
          const segment = graphemes.segment(current.target.slice(offset)).containing(end - offset - 1);
          if (segment) end = offset + segment.index + segment.segment.length;
        }
        current.shown = current.target.slice(0, end);
        current.previousFrame = now;
        setDisplayed(current.shown);
      }
      if (current.shown.length < current.target.length) current.frame = requestAnimationFrame(advance);
    };
    current.frame = requestAnimationFrame(advance);
  }, [streaming, text]);

  const visible = text.startsWith(displayed) ? displayed : text;
  return { text: visible, pending: visible !== text };
}

export type ReasoningStreamUpdate = { index: number; text: string; active: boolean };

/** Observe provider deltas before either SDK loop buffers a completed response. */
export function createReasoningStreamObserver(publish: (update: ReasoningStreamUpdate) => void | Promise<void>) {
  const segments = new Map<string, ReasoningStreamUpdate>();
  return async (part: { type: string; id?: string; delta?: string }) => {
    if (part.type === 'finish') {
      for (const segment of segments.values()) {
        if (segment.active && segment.text) { segment.active = false; await publish({ ...segment }); }
      }
      return;
    }
    if (!['reasoning-start', 'reasoning-delta', 'reasoning-end'].includes(part.type)) return;
    const id = part.id || 'reasoning';
    let segment = segments.get(id);
    if (!segment) {
      segment = { index: segments.size, text: '', active: true };
      segments.set(id, segment);
    }
    if (part.type === 'reasoning-delta' && part.delta) {
      segment.text += part.delta;
      segment.active = true;
      await publish({ ...segment });
    } else if (part.type === 'reasoning-end' && segment.text) {
      segment.active = false;
      await publish({ ...segment });
    }
  };
}

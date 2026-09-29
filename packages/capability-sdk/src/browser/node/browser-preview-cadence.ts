export const DEFAULT_BROWSER_PREVIEW_FPS = 20;
export const MIN_BROWSER_PREVIEW_FPS = 1;
export const MAX_BROWSER_PREVIEW_FPS = 60;

export function browserPreviewFramesPerSecond(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_BROWSER_PREVIEW_FPS;
  return Math.min(MAX_BROWSER_PREVIEW_FPS, Math.max(MIN_BROWSER_PREVIEW_FPS, Math.floor(numeric)));
}

export function browserPreviewFrameIntervalMs(value: unknown) {
  return Math.ceil(1000 / browserPreviewFramesPerSecond(value));
}

export type BrowserPreviewDemand = { width: number; height: number; pressured: boolean };

/** Slow down promptly under load; restore quality gradually to avoid oscillation. */
export class BrowserPreviewAdaptivePolicy {
  fps: number;
  scale = 1;
  private averageMs = 0;
  private lastAdjustment = 0;
  private healthySamples = 0;
  private dimensions?: { width: number; height: number };
  private candidateKey = '';
  private candidateSince = 0;
  private viewportKey = '';
  constructor(private readonly ceiling: number) { this.fps = ceiling; }

  observe(durationMs: number, pressured: boolean, now = Date.now()) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;
    this.averageMs = this.averageMs ? this.averageMs * 0.8 + durationMs * 0.2 : durationMs;
    if (now - this.lastAdjustment < 2_000) return;
    this.lastAdjustment = now;
    const capacity = Math.max(1, Math.floor(1000 / (this.averageMs * 1.2)));
    if (pressured || capacity < this.fps) {
      this.fps = Math.min(capacity, Math.max(Math.min(5, this.fps), Math.floor(this.fps * 0.8)));
      if (pressured) this.scale = Math.max(0.5, this.scale - 0.125);
      this.healthySamples = 0;
    } else if (++this.healthySamples >= 3) {
      this.fps = Math.min(this.ceiling, capacity, this.fps + 2);
      this.scale = Math.min(1, this.scale + 0.125);
      this.healthySamples = 0;
    }
  }

  output(viewport: { width: number; height: number }, maximum: { width: number; height: number }, demand?: BrowserPreviewDemand, now = Date.now()) {
    // Round display demand up to avoid an encoder restart for every CSS pixel.
    const width = demand ? Math.ceil(demand.width / 64) * 64 : maximum.width;
    const height = demand ? Math.ceil(demand.height / 64) * 64 : maximum.height;
    const ratio = Math.min(1, maximum.width / viewport.width, maximum.height / viewport.height,
      Math.max(320, width) / viewport.width, Math.max(240, height) / viewport.height) * this.scale;
    const candidate = { width: Math.max(2, Math.floor(viewport.width * ratio / 2) * 2),
      height: Math.max(2, Math.floor(viewport.height * ratio / 2) * 2) };
    const key = `${candidate.width}x${candidate.height}`;
    if (key !== this.candidateKey) { this.candidateKey = key; this.candidateSince = now; }
    const viewportKey = `${viewport.width}x${viewport.height}`;
    if (!this.dimensions || viewportKey !== this.viewportKey || now - this.candidateSince >= 1_000) this.dimensions = candidate;
    this.viewportKey = viewportKey;
    return this.dimensions;
  }
}

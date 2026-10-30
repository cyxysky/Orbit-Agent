import { raceWithAbort } from '../../index.ts';

/** One budget, including queued work, preparation, execution and result handling. */
export class BrowserOperationDeadline {
  readonly startedAt = Date.now();
  readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  phase = 'queued';
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly disposers: Array<() => void> = [];

  constructor(readonly timeoutMs: number, parent?: AbortSignal) {
    this.follow(parent);
    this.timer = setTimeout(() => {
      const error = new Error(`Browser tool timed out after ${timeoutMs}ms during ${this.phase}.`);
      error.name = 'TimeoutError';
      this.controller.abort(error);
    }, timeoutMs);
  }

  follow(signal?: AbortSignal) {
    if (!signal || signal === this.signal) return;
    const abort = () => this.controller.abort(signal.reason);
    if (signal.aborted) abort();
    else {
      signal.addEventListener('abort', abort, { once: true });
      this.disposers.push(() => signal.removeEventListener('abort', abort));
    }
  }

  async step<T>(phase: string, operation: () => Promise<T>): Promise<T> {
    this.signal.throwIfAborted();
    this.phase = phase;
    const value = await raceWithAbort(Promise.resolve().then(() => {
      this.signal.throwIfAborted();
      return operation();
    }), this.signal);
    // A late completion cannot start the next stage or publish a result.
    this.signal.throwIfAborted();
    return value;
  }

  dispose() {
    clearTimeout(this.timer);
    for (const dispose of this.disposers) dispose();
  }
}

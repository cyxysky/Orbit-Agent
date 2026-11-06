/** Coalesce read-only work while cancelling it once its last caller leaves. */
export function createSharedRead<K, V>(read: (key: K, signal: AbortSignal) => Promise<V>) {
  type Pending = { controller: AbortController; promise: Promise<V>; callers: number; settled: boolean };
  const pending = new Map<K, Pending>();
  return (key: K, signal?: AbortSignal): Promise<V> => {
    if (signal?.aborted) return Promise.reject(signal.reason);
    let entry = pending.get(key);
    if (!entry || entry.controller.signal.aborted) {
      const controller = new AbortController();
      const next: Pending = { controller, callers: 0, settled: false, promise: undefined! };
      next.promise = Promise.resolve().then(() => { controller.signal.throwIfAborted(); return read(key, controller.signal); })
        .finally(() => { next.settled = true; if (pending.get(key) === next) pending.delete(key); });
      pending.set(key, next); entry = next;
    }
    const current = entry;
    current.callers += 1;
    return new Promise<V>((resolve, reject) => {
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        signal?.removeEventListener('abort', abort);
        current.callers -= 1;
        if (!current.callers && !current.settled) current.controller.abort();
      };
      const abort = () => { release(); reject(signal?.reason); };
      signal?.addEventListener('abort', abort, { once: true });
      current.promise.then(value => { release(); resolve(value); }, error => { release(); reject(error); });
      if (signal?.aborted) abort();
    });
  };
}

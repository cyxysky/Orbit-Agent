/** A byte- and entry-bounded buffer. Rejected writes leave existing entries intact. */
export class BoundedEventBuffer<TKey, TValue> {
  private readonly records = new Map<TKey, { value: TValue; bytes: number }>();
  private retainedBytes = 0;

  constructor(private readonly maxEntries = 96, private readonly maxBytes = 2 * 1024 * 1024) {}

  get size() { return this.records.size; }
  get(key: TKey): TValue | undefined { return this.records.get(key)?.value; }

  set(key: TKey, value: TValue): boolean {
    // Transport records are JSON. Count UTF-16 storage without allocating a
    // second encoded buffer solely to measure every incoming packet.
    const bytes = (JSON.stringify(value)?.length ?? 0) * 2;
    const previous = this.records.get(key);
    if ((!previous && this.size >= this.maxEntries)
      || this.retainedBytes - (previous?.bytes ?? 0) + bytes > this.maxBytes) return false;
    this.records.set(key, { value, bytes });
    this.retainedBytes += bytes - (previous?.bytes ?? 0);
    return true;
  }

  delete(key: TKey) {
    const previous = this.records.get(key);
    if (!previous) return;
    this.retainedBytes -= previous.bytes;
    this.records.delete(key);
  }

  *entries(): IterableIterator<[TKey, TValue]> {
    for (const [key, record] of this.records) yield [key, record.value];
  }

  *values(): IterableIterator<TValue> {
    for (const record of this.records.values()) yield record.value;
  }

  take(limit = this.size): TValue[] {
    const result: TValue[] = [];
    for (const [key, record] of this.records) {
      if (result.length >= limit) break;
      result.push(record.value);
      this.delete(key);
    }
    return result;
  }

  clear() { this.records.clear(); this.retainedBytes = 0; }
}

import { createHash } from 'node:crypto';

function compare(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => compare(a, b))
    .map(([key, item]) => [key, canonical(item)]));
}

/** Retrieval counters do not change the content reviewed by the user. */
export function memoryContentHash(items: readonly { id: string }[]) {
  const content = items.map(item => Object.fromEntries(Object.entries(item)
    .filter(([key]) => key !== 'lastUsedAt' && key !== 'useCount')))
    .sort((a, b) => compare(String(a.id), String(b.id)));
  return createHash('sha256').update(JSON.stringify(canonical(content))).digest('hex');
}

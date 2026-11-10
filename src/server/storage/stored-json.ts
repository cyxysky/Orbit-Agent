import { gzipSync, gunzipSync } from 'node:zlib';
import { browserChatLogUsage } from '@/lib/browser-chat-log-usage';

export type StoredJsonRow = { record_json: string; record_gzip?: Uint8Array | null };
type EncodedJsonRow = { record_json: string; record_gzip: Buffer | null };
const minimumBytes = 16 * 1024;
const maximumBytes = 64 * 1024 * 1024;

/** Keep queryable metadata alongside an optional lossless payload. Plain JSON remains cheaper for small rows. */
export function encodeStoredJson(json: string, projection: () => unknown): EncodedJsonRow {
  const bytes = Buffer.byteLength(json);
  if (bytes < minimumBytes || bytes > maximumBytes) return { record_json: json, record_gzip: null };
  const gzip = gzipSync(json, { level: 1 });
  if (gzip.byteLength >= bytes * 0.85) return { record_json: json, record_gzip: null };
  const metadata = JSON.stringify(projection() ?? {});
  return Buffer.byteLength(metadata) + gzip.byteLength < bytes * 0.85
    ? { record_json: metadata, record_gzip: gzip }
    : { record_json: json, record_gzip: null };
}

export function storedJsonText(row: StoredJsonRow) {
  return row.record_gzip == null ? row.record_json
    : gunzipSync(row.record_gzip, { maxOutputLength: maximumBytes }).toString('utf8');
}

export function encodeConversationJson(kind: 'log' | 'context' | 'request', json: string) {
  return encodeStoredJson(json, () => {
    if (kind !== 'log') return {};
    const record = JSON.parse(json) as Record<string, unknown>;
    const { details: _details, ...header } = record;
    void _details;
    const usage = browserChatLogUsage(record);
    return { ...header, details: usage ? { aiOutput: { usage } } : undefined };
  });
}

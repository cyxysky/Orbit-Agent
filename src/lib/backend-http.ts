import { Agent as HttpAgent, get as httpGet } from 'node:http';
import { Agent as HttpsAgent, get as httpsGet } from 'node:https';

const httpAgent = new HttpAgent({ keepAlive: true, maxSockets: 16, maxFreeSockets: 4, timeout: 30_000 });
const httpsAgent = new HttpsAgent({ keepAlive: true, maxSockets: 16, maxFreeSockets: 4, timeout: 30_000 });

/** Internal JSON reads bypass Next's fetch instrumentation and proxy dispatchers. */
export function readBackendJson<T>(url: URL, headers: Record<string, string>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const get = url.protocol === 'https:' ? httpsGet : url.protocol === 'http:' ? httpGet : undefined;
    if (!get) { reject(new Error('Unsupported backend protocol')); return; }
    const request = get(url, { headers, agent: url.protocol === 'https:' ? httpsAgent : httpAgent }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 8_000_000) {
          response.destroy(new Error('Backend page data exceeds 8 MB'));
          return;
        }
        chunks.push(chunk);
      });
      response.once('error', reject);
      response.once('end', () => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Unable to load page data (${response.statusCode})`));
          return;
        }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T); }
        catch (cause) { reject(new Error('Backend returned invalid JSON', { cause })); }
      });
    });
    // A writable Error survives Next's error formatting. AbortSignal.timeout()
    // produces a DOMException whose getter-only message masks the real failure.
    const deadline = setTimeout(() => request.destroy(Object.assign(
      new Error(`Backend page request timed out: ${url.pathname}`), { code: 'ETIMEDOUT' },
    )), Math.max(1, timeoutMs));
    request.once('close', () => clearTimeout(deadline));
    request.once('error', reject);
  });
}

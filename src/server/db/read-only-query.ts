import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { databaseDriver, getDatabase, queryDatabase, registerDatabaseDisposer, sqliteDatabasePath } from './database';

type Pending = { resolve(value: unknown[]): void; reject(error: Error): void; cleanup(): void };
type Slot = { file: string; worker: Worker; requests: Map<number, Pending>; idle?: ReturnType<typeof setTimeout> };
let slot: Slot | undefined;
let nextId = 0;
const workerCode = String.raw`
import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
const Database = createRequire(workerData.driver)(workerData.driver);
const database = new Database(workerData.file, { readonly: true, fileMustExist: true, timeout: 1000 });
database.pragma('query_only = ON');
database.pragma('cache_size = -2048');
parentPort.on('message', ({ id, sql, parameters }) => {
  try {
    const statement = database.prepare(sql);
    if (!statement.reader || !statement.readonly) throw new Error('Only read-only database queries are allowed.');
    parentPort.postMessage({ id, rows: statement.all(...parameters) });
  } catch (error) { parentPort.postMessage({ id, error: error.message }); }
});
`;

function stop(current: Slot, error = new Error('Read-only database worker closed.')) {
  if (slot === current) slot = undefined;
  clearTimeout(current.idle);
  for (const pending of current.requests.values()) { pending.cleanup(); pending.reject(error); }
  current.requests.clear();
  return current.worker.terminate().then(() => undefined, () => undefined);
}
function release(current: Slot) {
  if (current.requests.size) return;
  current.worker.unref();
  clearTimeout(current.idle);
  current.idle = setTimeout(() => stop(current), 10_000);
  current.idle.unref();
}
function workerFor(file: string) {
  if (slot?.file === file) return slot;
  if (slot) stop(slot);
  const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(workerCode)), {
    workerData: { file, driver: createRequire(import.meta.url).resolve('better-sqlite3') },
    resourceLimits: { maxOldGenerationSizeMb: 64 } });
  const current: Slot = { file, worker, requests: new Map() };
  slot = current;
  worker.on('message', (message: { id: number; rows?: unknown[]; error?: string }) => {
    const pending = current.requests.get(message.id);
    if (!pending) return;
    current.requests.delete(message.id); pending.cleanup();
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.rows || []);
    release(current);
  });
  worker.once('error', error => stop(current, error));
  worker.once('exit', code => { if (slot === current || current.requests.size) void stop(current, new Error(`Read-only database worker exited (${code}).`)); });
  return current;
}

/** SQLite's synchronous driver must not block unrelated API requests during large reads. */
export async function queryReadOnlyDatabase<T>(sql: string, parameters: unknown[] = [], signal?: AbortSignal): Promise<T[]> {
  signal?.throwIfAborted();
  if (databaseDriver() !== 'sqlite') {
    const rows = await queryDatabase<T>(sql, parameters);
    signal?.throwIfAborted(); return rows;
  }
  await getDatabase();
  signal?.throwIfAborted();
  const current = workerFor(sqliteDatabasePath());
  clearTimeout(current.idle); current.worker.ref();
  return new Promise<T[]>((resolve, reject) => {
    const id = ++nextId;
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const abort = () => {
      if (!current.requests.delete(id)) return;
      cleanup(); reject(signal?.reason);
      if (!current.requests.size) stop(current);
    };
    current.requests.set(id, { resolve: rows => resolve(rows as T[]), reject, cleanup });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try { current.worker.postMessage({ id, sql, parameters: parameters.map(value => value instanceof Date ? value.toISOString() : typeof value === 'boolean' ? Number(value) : value ?? null) }); }
    catch (error) { current.requests.delete(id); cleanup(); reject(error); release(current); }
  });
}

export function closeReadOnlyDatabaseWorker() { return slot ? stop(slot) : Promise.resolve(); }
registerDatabaseDisposer(closeReadOnlyDatabaseWorker);

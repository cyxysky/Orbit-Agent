import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { CapabilityTaskQueue } from '../task-queue.ts';
import type { EChartsMapRegistration } from './core.ts';

export type EChartsRenderInput = {
  option: Record<string, unknown>;
  maps?: readonly EChartsMapRegistration[];
  height?: number;
  image?: boolean;
};

type RendererSlot = {
  worker: Worker;
  registrationKey: string;
  tasks: number;
  bytes: number;
  dead: boolean;
  timer?: ReturnType<typeof setTimeout>;
  exited: Promise<number>;
};

// Share one renderer during bursts, then release its libraries and global registries.
// Both task count and input volume bound a busy worker that never becomes idle.
const queue = new CapabilityTaskQueue({ concurrency: 1, maxQueued: 16 });
const idleMs = 5_000;
let current: RendererSlot | undefined;
let retiring: Promise<number> | undefined;
let nextId = 0;

function start(registrationKey: string): RendererSlot {
  const worker = new Worker(new URL('../../runtime/chart/render-worker.cjs', import.meta.url), {
    execArgv: [], stdout: true, stderr: true,
  });
  worker.stdout?.resume();
  worker.stderr?.resume();
  const slot: RendererSlot = {
    worker, registrationKey, tasks: 0, bytes: 0, dead: false,
    exited: new Promise(resolve => worker.once('exit', code => {
      slot.dead = true;
      clearTimeout(slot.timer);
      if (current === slot) current = undefined;
      resolve(code);
    })),
  };
  // Each active request also observes errors; this listener covers idle failures.
  worker.on('error', () => { slot.dead = true; if (current === slot) current = undefined; });
  current = slot;
  return slot;
}

function retire(slot: RendererSlot): Promise<number> {
  if (current === slot) current = undefined;
  clearTimeout(slot.timer);
  if (slot.dead) return slot.exited;
  slot.worker.ref();
  slot.worker.postMessage({ dispose: true });
  const timer = setTimeout(() => { void slot.worker.terminate(); }, 1_000);
  const pending = slot.exited.finally(() => clearTimeout(timer));
  retiring = pending;
  void pending.finally(() => { if (retiring === pending) retiring = undefined; });
  return pending;
}

export function renderECharts(input: EChartsRenderInput): Promise<string | undefined> {
  return queue.run(async signal => {
    await retiring;
    signal.throwIfAborted();
    // ECharts registrations are global. Only reuse a worker with the exact same
    // registration set; a later request must not inherit another chart's maps.
    const registrationKey = createHash('sha256').update(JSON.stringify(input.maps || [])).digest('hex');
    if (current && current.registrationKey !== registrationKey) await retire(current);
    const slot = current || start(registrationKey);
    clearTimeout(slot.timer);
    slot.worker.ref();
    const id = ++nextId;
    let reusable = false;
    try {
      const value = await new Promise<string | undefined>((resolve, reject) => {
        const cleanup = () => {
          slot.worker.off('message', message);
          slot.worker.off('error', failure);
          slot.worker.off('exit', exited);
          signal.removeEventListener('abort', abort);
        };
        const finish = (error?: unknown, value?: string) => { cleanup(); error ? reject(error) : resolve(value); };
        const message = (result: { id: number; ok: boolean; error?: string; data?: string }) => {
          if (result.id !== id) return;
          reusable = result.ok === true;
          finish(result.ok ? undefined : new Error(result.error), result.data);
        };
        const failure = (error: Error) => finish(error);
        const exited = (code: number) => finish(new Error('Chart renderer exited without a result (' + code + ').'));
        const abort = () => finish(signal.reason || new Error('Chart rendering aborted.'));
        slot.worker.on('message', message);
        slot.worker.once('error', failure);
        slot.worker.once('exit', exited);
        signal.addEventListener('abort', abort, { once: true });
        try { slot.worker.postMessage({ id, input }); }
        catch (error) { finish(error); }
      });
      slot.tasks++;
      slot.bytes += JSON.stringify(input).length * 2;
      return value;
    } finally {
      if (!reusable || slot.dead || slot.tasks >= 32 || slot.bytes >= 8 * 1024 * 1024) await retire(slot);
      else {
        slot.worker.unref();
        slot.timer = setTimeout(() => { void retire(slot); }, idleMs);
        slot.timer.unref();
      }
    }
  }, { executionTimeoutMs: 60_000 });
}

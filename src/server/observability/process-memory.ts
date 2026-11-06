import { getHeapStatistics } from 'node:v8';
import { freemem, totalmem } from 'node:os';

export type ProcessMemorySnapshot = {
  pid: number; role: string; capturedAt: string; uptimeSeconds: number;
  rss: number; heapUsed: number; heapTotal: number; heapLimit: number; external: number; arrayBuffers: number;
};
let parent: ProcessMemorySnapshot | undefined;
export function processMemorySnapshot(role = process.env.WEBPILOT_SERVER_ROLE || 'api'): ProcessMemorySnapshot {
  const usage = process.memoryUsage();
  return { ...usage, pid: process.pid, role, capturedAt: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()), heapLimit: getHeapStatistics().heap_size_limit };
}
export function receiveParentProcessMemory(value: unknown) {
  const snapshot = value as ProcessMemorySnapshot | undefined;
  if (!snapshot || snapshot.role !== 'api' || !Number.isInteger(snapshot.pid)
    || !['rss', 'heapUsed', 'heapTotal', 'heapLimit', 'external', 'arrayBuffers'].every(key => Number.isFinite(snapshot[key as keyof ProcessMemorySnapshot]))) return;
  parent = snapshot;
}
export function backendMemorySnapshot() {
  const current = processMemorySnapshot();
  const processes = parent && parent.pid !== current.pid ? [parent, current] : [current];
  return { processes, nodeRssBytes: processes.reduce((sum, item) => sum + item.rss, 0),
    host: { totalBytes: totalmem(), freeBytes: freemem() } };
}

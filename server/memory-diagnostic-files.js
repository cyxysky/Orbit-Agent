/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const v8 = require('node:v8');
const { randomUUID } = require('node:crypto');

function createMemoryDiagnosticFiles() {
  const directory = path.resolve(process.env.APP_DATA_DIR || path.join(process.cwd(), 'runtime'), 'diagnostics', 'memory');
  const role = String(process.env.WEBPILOT_SERVER_ROLE || 'single').replace(/[^a-z0-9_-]/gi, '_');
  const logPath = path.join(directory, `memory-${role}-${process.pid}.jsonl`);
  const maxBytes = 10 * 1024 * 1024;
  let lastError;
  let lastHeapSnapshot;
  let lastCaptureAt = 0;
  let captureInProgress = false;
  let baselineSnapshot;

  function prune(pattern, maximum, preserve) {
    const files = fs.readdirSync(directory).filter(name => pattern.test(name)).map(name => {
      const file = path.join(directory, name);
      return { file, time: fs.statSync(file).mtimeMs };
    }).sort((a, b) => b.time - a.time);
    const preserved = new Set(Array.isArray(preserve) ? preserve : [preserve]);
    let retained = files.filter(entry => preserved.has(entry.file)).length;
    for (const entry of files) {
      if (preserved.has(entry.file)) continue;
      if (retained++ >= maximum) fs.unlinkSync(entry.file);
    }
  }

  function write(payload) {
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const line = `${JSON.stringify(payload)}\n`;
      if (fs.existsSync(logPath) && fs.statSync(logPath).size + Buffer.byteLength(line) > maxBytes) {
        for (let index = 4; index >= 1; index--) {
          const target = `${logPath}.${index}`;
          const source = index === 1 ? logPath : `${logPath}.${index - 1}`;
          if (fs.existsSync(target)) fs.unlinkSync(target);
          if (fs.existsSync(source)) fs.renameSync(source, target);
        }
      }
      fs.appendFileSync(logPath, line, { encoding: 'utf8', mode: 0o600 });
      prune(/^memory-[a-z0-9_-]+-\d+\.jsonl(?:\.[1-4])?$/i, 20, logPath);
      lastError = undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (lastError !== message) console.error('[memory-diagnostics] Unable to persist memory diagnostics:', message);
      lastError = message;
    }
  }

  function captureHeapSnapshot(reason = 'manual') {
    if (captureInProgress || Date.now() - lastCaptureAt < 60_000) throw new Error('Heap snapshots are limited to one per minute.');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const requiredBytes = v8.getHeapStatistics().used_heap_size * 2 + 512 * 1024 * 1024;
    const disk = fs.statfsSync(directory);
    if (disk.bavail * disk.bsize < requiredBytes) throw new Error('Insufficient free disk space to capture a heap snapshot.');
    captureInProgress = true;
    lastCaptureAt = Date.now();
    const file = path.join(directory, `heap-${role}-${process.pid}-${reason}-${Date.now()}-${randomUUID()}.heapsnapshot`);
    write({ time: new Date().toISOString(), event: 'process.memory.heap-snapshot.start', pid: process.pid, reason, file });
    try {
      fs.closeSync(fs.openSync(file, 'wx', 0o600));
      v8.writeHeapSnapshot(file);
      lastHeapSnapshot = { file, bytes: fs.statSync(file).size, createdAt: new Date().toISOString(), pid: process.pid, reason };
      if (reason === 'startup') baselineSnapshot = file;
      write({ time: new Date().toISOString(), event: 'process.memory.heap-snapshot.complete', ...lastHeapSnapshot });
      // UI and API captures must not evict one another's comparison baseline.
      try { prune(new RegExp(`^heap-${role}-[a-z0-9_-]+\\.heapsnapshot$`, 'i'), 3, [file, baselineSnapshot]); } catch (error) {
        write({ time: new Date().toISOString(), event: 'process.memory.heap-snapshot.retention-error', error: String(error) });
      }
      return lastHeapSnapshot;
    } catch (error) {
      write({ time: new Date().toISOString(), event: 'process.memory.heap-snapshot.failed', reason, error: String(error) });
      try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* Preserve the original capture error. */ }
      throw error;
    } finally { captureInProgress = false; }
  }

  return { write, captureHeapSnapshot, status: () => ({ directory, logPath, maxFileBytes: maxBytes, retainedLogFiles: 20,
    retainedHeapSnapshots: 3, lastError, lastHeapSnapshot }) };
}

module.exports = { createMemoryDiagnosticFiles };

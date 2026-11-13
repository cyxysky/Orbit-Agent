const fs = require('node:fs');
const path = require('node:path');
const { writeJson } = require('./atomic-json.cjs');
const { createInstallProgress, advanceInstallProgress } = require('./install-progress.cjs');

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; } }
function redact(text, secrets = []) {
  let safe = String(text).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '\n');
  for (const secret of [...secrets].filter(v => typeof v === 'string' && v.length >= 4).sort((a, b) => b.length - a.length)) {
    safe = safe.replaceAll(secret, '[redacted]');
  }
  return safe.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/((?:token|api[_-]?key|password|authorization|_authToken)["']?\s*[:=]\s*["']?)[^\s,"']+/gi, '$1[redacted]');
}
function createInstallJournal({ root, tool, jobId, signal, secrets = [] }) {
  const file = path.join(root, '.state', tool.id + '.json');
  const cancelFile = path.join(root, '.state', tool.id + '.cancel.json');
  let value = { id: tool.id, jobId, state: 'installing', phase: 'source', message: '正在准备安装',
    progress: createInstallProgress(tool), pid: process.pid, startedAt: new Date().toISOString(), logs: '' };
  let revision = 0, writtenRevision = 0, writing, writeError;
  const flush = () => {
    // Coalesce output while preserving phase order. A heartbeat must never
    // replace a newer terminal state after an asynchronous rename finishes.
    if (!writing) writing = (async () => {
      while (writtenRevision !== revision) {
        const current = revision;
        await writeJson(file, { ...value, updatedAt: new Date().toISOString() });
        writtenRevision = current;
      }
    })().finally(() => { writing = undefined; });
    return writing;
  };
  const failedWrite = error => { writeError = error; signal.abort(error); };
  const check = () => {
    if (readJson(cancelFile)?.jobId === jobId) signal.abort(new Error('安装已取消'));
    signal.signal.throwIfAborted();
  };
  const heartbeat = setInterval(() => {
    try { check(); value.heartbeatAt = new Date().toISOString(); revision++; void flush().catch(failedWrite); } catch { /* execute observes abort */ }
  }, 1000);
  heartbeat.unref();
  const pending = setInterval(() => { if (writtenRevision !== revision) void flush().catch(failedWrite); }, 250);
  pending.unref();
  return {
    check,
    get writeError() { return writeError; },
    async state(phase, message, extra = {}) {
      if (!['failed', 'cancelled', 'ready'].includes(phase)) check();
      value = { ...value, download: undefined, ...extra, phase, message: redact(message, secrets),
        progress: advanceInstallProgress(value.progress, phase), lastActivityAt: new Date().toISOString() };
      if (extra.error) value.error = redact(extra.error, secrets).slice(-4000);
      revision++;
      await flush();
    },
    output(text) {
      value.logs = (value.logs + redact(text, secrets)).slice(-24000).replace(/^[\uDC00-\uDFFF]/, '');
      value.lastActivityAt = new Date().toISOString(); revision++;
    },
    progress(patch) {
      value.download = undefined;
      if (typeof patch.message === 'string') value.message = redact(patch.message, secrets).slice(0, 500);
      if (patch.download && Number.isFinite(patch.download.receivedBytes) && Number.isFinite(patch.download.totalBytes)) {
        value.download = { receivedBytes: patch.download.receivedBytes, totalBytes: patch.download.totalBytes };
      }
      value.lastActivityAt = new Date().toISOString(); revision++;
    },
    async close() { clearInterval(heartbeat); clearInterval(pending); if (writing || writtenRevision !== revision) await flush(); },
  };
}
module.exports = { createInstallJournal, readJson, writeJson, redact };

/* eslint-disable @typescript-eslint/no-require-imports */
// Native PTYs own OS handles and worker threads. Isolate each terminal so that
// natural shell exit, native failures and shutdown release all of those handles.
const pty = require('node-pty');
let terminal, stopping = false, finished = false, deadline, pendingBytes = 0;
let resizeReady = process.platform !== 'win32';
const pendingResizes = [];
function send(message, callback) {
  if (!process.connected) { callback?.(); return; }
  process.send(message, error => { callback?.(); if (error) stop(); });
}
function finish(exitCode) {
  if (finished) return;
  finished = true; clearTimeout(deadline);
  const timer = setTimeout(() => process.exit(0), 500);
  send({ type: 'exit', exitCode }, () => { clearTimeout(timer); process.exit(0); });
}
function stop() {
  if (stopping || finished) return;
  stopping = true;
  deadline = setTimeout(() => {
    if (terminal) {
      try { process.kill(process.platform === 'win32' ? terminal.pid : -terminal.pid, 'SIGKILL'); } catch { /* already exited */ }
    }
    finish(130);
  }, 3000);
  try { if (terminal) terminal.kill(); else finish(130); }
  catch { finish(130); }
}
function resize(message) {
  terminal.resize(message.cols, message.rows);
  send({ type: 'resized', requestId: message.requestId, cols: message.cols, rows: message.rows });
}
process.on('message', message => {
  try {
    if (message.type === 'start') {
      if (terminal || stopping) throw new Error('PTY host already initialized.');
      terminal = pty.spawn(message.executable, message.args, {
        ...message.options, ...(process.platform === 'win32' ? { useConptyDll: true } : {}),
      });
      terminal.onData(output => {
        // Bound queued IPC data independently of the retained transcript.
        pendingBytes += Buffer.byteLength(output);
        if (pendingBytes > 4 * 1024 * 1024) {
          send({ type: 'error', message: 'Terminal output consumer is not responding.' }); stop(); return;
        }
        send({ type: 'data', output }, () => { pendingBytes -= Buffer.byteLength(output); });
        if (!resizeReady) {
          // node-pty marks its Windows socket ready before forwarding the first
          // data event. Keep that initial output at its original geometry, then
          // apply queued resizes now that native resize will execute immediately.
          resizeReady = true;
          try { for (const request of pendingResizes.splice(0)) resize(request); }
          catch (error) { send({ type: 'error', message: error.message }); stop(); }
        }
      });
      terminal.onExit(event => finish(event.exitCode));
      send({ type: 'ready', pid: terminal.pid });
    } else if (message.type === 'write') terminal.write(message.input);
    else if (message.type === 'resize') {
      if (resizeReady) resize(message);
      else pendingResizes.push(message);
    } else if (message.type === 'close') stop();
  } catch (error) { send({ type: 'error', message: error.message }); stop(); }
});
process.on('disconnect', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

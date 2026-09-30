/* eslint-disable @typescript-eslint/no-require-imports */
const { fork } = require('node:child_process');
const { EventEmitter } = require('node:events');
const path = require('node:path');

function spawnTerminal(executable, args, options) {
  return new Promise((resolve, reject) => {
    const events = new EventEmitter();
    const child = fork(path.join(__dirname, 'pty-host.cjs'), [], {
      windowsHide: true, execArgv: [], env: { ...process.env, NODE_OPTIONS: '' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let ready = false, closed = false, pid, exitCode, failure, stderr = '';
    const timer = setTimeout(() => { failure = new Error('Terminal host startup timed out.'); child.kill(); }, 10000);
    const send = message => {
      if (closed || !child.connected) throw new Error('Terminal host is closed.');
      child.send(message, error => { if (error) { failure = error; child.kill(); } });
    };
    const subscribe = (type, listener) => { events.on(type, listener); return { dispose: () => events.off(type, listener) }; };
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-4000); });
    child.on('error', error => { failure = error; });
    child.on('message', message => {
      if (message.type === 'ready') {
        ready = true; pid = message.pid; clearTimeout(timer);
        resolve({ pid, write: input => send({ type: 'write', input }), resize: (cols, rows) => send({ type: 'resize', cols, rows }),
          kill: () => { if (!closed) send({ type: 'close' }); },
          onData: listener => subscribe('data', listener), onExit: listener => subscribe('exit', listener) });
      } else if (message.type === 'data') events.emit('data', message.output);
      else if (message.type === 'exit') exitCode = message.exitCode;
      else if (message.type === 'error') failure = new Error(message.message);
    });
    child.once('close', code => {
      closed = true; clearTimeout(timer);
      if (pid && exitCode === undefined) {
        // A native host crash must not orphan its shell or descendants.
        try { process.kill(process.platform === 'win32' ? pid : -pid, 'SIGKILL'); } catch { /* already exited */ }
      }
      if (!ready) reject(failure || new Error(stderr || `Terminal host exited (${code}).`));
      else {
        if (failure) events.emit('data', `\r\n[terminal] ${failure.message}\r\n`);
        events.emit('exit', { exitCode: exitCode ?? code ?? 1 }); events.removeAllListeners();
      }
    });
    send({ type: 'start', executable, args, options });
  });
}
module.exports = { spawnTerminal };

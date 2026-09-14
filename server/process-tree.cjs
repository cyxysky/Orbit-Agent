/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require('node:child_process');
const { readdirSync, readFileSync } = require('node:fs');

function linuxDescendants(pid) {
  const children = new Map();
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const parent = Number(/^PPid:\s+(\d+)/m.exec(readFileSync(`/proc/${name}/status`, 'utf8'))?.[1]);
      const siblings = children.get(parent) || [];
      siblings.push(Number(name)); children.set(parent, siblings);
    } catch { /* Processes may exit while enumerating. */ }
  }
  const result = [];
  const visit = parent => { for (const child of children.get(parent) || []) { visit(child); result.push(child); } };
  visit(pid);
  return result;
}

function stopProcessTree(child, { force = false } = {}) {
  if (!child || child.exitCode != null) return Promise.resolve();
  const kill = () => {
    if (child.exitCode != null) return;
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => child.kill('SIGKILL'));
    } else {
      // Chromium and execution children may start their own process groups.
      // Capture descendants before killing their parent so they cannot orphan.
      if (process.platform === 'linux' && child.pid) {
        try {
          for (const pid of linuxDescendants(child.pid)) {
            try { process.kill(pid, 'SIGKILL'); } catch { /* Already exited. */ }
          }
        } catch { /* Fall back to terminating the known parent. */ }
      }
      child.kill('SIGKILL');
    }
  };
  if (force) { kill(); return Promise.resolve(); }
  return new Promise(resolve => {
    const timer = setTimeout(kill, 12000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    if (child.connected && child.send) child.send({ type: 'shutdown' }, () => undefined);
    else child.kill('SIGTERM');
  });
}
module.exports = { stopProcessTree };

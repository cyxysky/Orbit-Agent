import { spawn, type ChildProcess } from 'node:child_process';

/** Both runners create a process group on Unix; Windows terminal also owns a Job Object. */
export function terminateProcessTree(child: ChildProcess) {
  if (!child.pid) return;
  const killChild = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try { child.kill('SIGKILL'); } catch { /* Already exited. */ }
  };
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore', windowsHide: true,
    });
    killer.once('error', killChild);
    killer.once('exit', code => { if (code) killChild(); });
    killer.unref();
    return;
  }
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ }
  killChild();
}

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TerminalProcess } from '../../../runtime/terminal/pty-host-client.cjs';
import { quotePowerShell, type TerminalShell } from './shell-integration.ts';
import { windowsTerminalJobType } from './windows-job.ts';

const jobAssemblies = new Map<string, Promise<string>>();
async function windowsJobAssembly(shell: string, env: NodeJS.ProcessEnv): Promise<string> {
  const previous = jobAssemblies.get(shell);
  if (previous) return previous;
  const build = (async () => {
    const cache = path.join(tmpdir(), 'capability-terminal-jobs');
    const digest = createHash('sha256').update(shell + windowsTerminalJobType).digest('hex').slice(0, 24);
    const assembly = path.join(cache, digest + '.dll');
    try { await access(assembly); return assembly; } catch { /* First use of this runtime. */ }
    await mkdir(cache, { recursive: true });
    const directory = await mkdtemp(path.join(cache, 'compile-'));
    try {
      const target = path.join(directory, 'job.dll');
      const source = "Add-Type -TypeDefinition @'\n" + windowsTerminalJobType + "\n'@ -OutputAssembly " + quotePowerShell(target) + " -ErrorAction Stop";
      const child = spawn(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], {
        env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
      });
      let stderr = '';
      child.stderr.setEncoding('utf8'); child.stderr.on('data', text => { stderr = (stderr + text).slice(-2000); });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { child.kill(); }, 15000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Cannot initialize terminal process ownership: ' + stderr)); });
      });
      try { await rename(target, assembly); }
      catch (error) { try { await access(assembly); } catch { throw error; } }
      return assembly;
    } finally { await rm(directory, { recursive: true, force: true }); }
  })();
  jobAssemblies.set(shell, build);
  try { return await build; } catch (error) { jobAssemblies.delete(shell); throw error; }
}

/** A fresh noninteractive shell: no PTY host, prompt hooks or command echo. */
export async function spawnPipeTerminal(shell: Exclude<TerminalShell, 'auto'>, command: string,
  directory: string, cwd: string, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<TerminalProcess> {
  signal?.throwIfAborted();
  const powerShell = shell !== 'bash';
  const source = path.join(directory, powerShell ? 'command.ps1' : 'command.bash');
  await writeFile(source, (powerShell ? '\ufeff' : '') + command + '\n', 'utf8');
  let args = ['--noprofile', '--norc', source];
  if (powerShell) {
    const assembly = process.platform === 'win32' ? await windowsJobAssembly(shell === 'powershell' ? 'powershell.exe' : shell, env) : undefined;
    const wrapper = path.join(directory, 'exec.ps1');
    await writeFile(wrapper, '\ufeff' + `
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$global:LASTEXITCODE = 0
try {
  ${assembly ? `Add-Type -Path ${quotePowerShell(assembly)} -ErrorAction Stop; [OrbitTerminalJob]::Attach()` : ''}
  . ${quotePowerShell(source)}
  $commandOk = $?
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
  if (-not $commandOk) { exit 1 }
} catch {
  [Console]::Error.WriteLine($_.ToString())
  exit 1
}
`, 'utf8');
    args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', wrapper];
  }
  signal?.throwIfAborted();
  const child = spawn(shell === 'powershell' ? 'powershell.exe' : shell, args, {
    cwd, env, stdio: 'pipe', windowsHide: true, detached: process.platform !== 'win32',
  });
  const events = new EventEmitter();
  let exited = false;
  const kill = () => {
    if (exited || !child.pid) return;
    if (process.platform === 'win32') {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.once('error', () => { if (!exited) child.kill('SIGKILL'); });
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => events.emit('data', chunk));
  child.stderr.on('data', chunk => events.emit('data', chunk));
  child.stdin.end();
  child.once('close', code => {
    exited = true;
    events.emit('exit', { exitCode: code ?? 1 });
    events.removeAllListeners();
  });
  await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  const subscribe = <T>(type: string, listener: (value: T) => void) => {
    events.on(type, listener);
    return { dispose: () => { events.off(type, listener); } };
  };
  return { pid: child.pid!, kill,
    write() { throw new Error('exec is noninteractive. Use create/run for an interactive PTY.'); },
    async resize() { throw new Error('A noninteractive exec has no terminal dimensions.'); },
    onData: listener => subscribe('data', listener), onResize: listener => subscribe('resize', listener), onExit: listener => subscribe('exit', listener),
  };
}

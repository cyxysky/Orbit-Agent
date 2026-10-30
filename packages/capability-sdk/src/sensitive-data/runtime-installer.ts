import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManagedSensitiveDataRuntime } from '../runtime.ts';

export type SensitiveDataInstallStatus = {
  state: 'missing' | 'installing' | 'ready' | 'failed';
  phase: string; message: string; step: number; totalSteps: number;
  directory: string; error?: string; updatedAt?: string;
};
const jobs = new Map<string, ChildProcess>();
function installerScript() {
  const candidates = [path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'runtime.cjs')];
  const packageName = '@cjfclonedeep/capability-sdk';
  try { candidates.push(path.resolve(path.dirname(fileURLToPath(import.meta.resolve(packageName))), '..', 'scripts', 'runtime.cjs')); } catch { /* Source module path above may already be sufficient. */ }
  const script = candidates.find(existsSync);
  if (!script) throw new Error('The SDK runtime installer is missing from this deployment.');
  return script;
}
export function createSensitiveDataRuntimeInstaller(input: { directory: string; nodeExecutable?: string }) {
  const directory = path.resolve(input.directory), statusFile = path.join(directory, 'sensitive-data-status.json');
  const environment = { ...process.env, CAPABILITY_RUNTIME_HOME: directory, CAPABILITY_SENSITIVE_DATA_RUNTIME_HOME: directory };
  function status(): SensitiveDataInstallStatus {
    if (readManagedSensitiveDataRuntime(environment)) return { state: 'ready', phase: 'ready', message: 'Local sensitive-data runtime is installed', step: 4, totalSteps: 4, directory };
    let saved: Record<string, unknown> = {};
    try { saved = JSON.parse(readFileSync(statusFile, 'utf8')); } catch { /* No installation has been requested. */ }
    const child = jobs.get(directory);
    let alive = !!child && child.exitCode === null && !child.killed;
    if (!alive && saved.state === 'installing' && typeof saved.pid === 'number') {
      try { process.kill(saved.pid, 0); alive = true; } catch { /* Interrupted worker. */ }
    }
    const state = alive ? 'installing' : saved.state === 'failed' || saved.state === 'installing' ? 'failed' : 'missing';
    return { state, phase: String(saved.phase || state), message: alive ? String(saved.message || 'Preparing download')
      : state === 'failed' ? 'Installation stopped; retry to resume cached downloads' : 'Download the local sensitive-data runtime before enabling this feature',
      step: Number(saved.step) || 0, totalSteps: 4, directory,
      error: saved.error ? String(saved.error).slice(-3000) : undefined,
      updatedAt: typeof saved.updatedAt === 'string' ? saved.updatedAt : undefined };
  }
  function writeFailure(message: string) {
    const temporary = statusFile + '.' + process.pid + '.tmp';
    writeFileSync(temporary, JSON.stringify({ state: 'failed', phase: 'failed', error: message.slice(-3000), updatedAt: new Date().toISOString() }));
    renameSync(temporary, statusFile);
  }
  return {
    status,
    start() {
      const before = status();
      if (before.state === 'ready' || before.state === 'installing') return before;
      const script = installerScript();
      mkdirSync(directory, { recursive: true });
      const child = spawn(input.nodeExecutable || process.execPath, [script, 'install', 'sensitive-data'], {
        env: environment, cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      jobs.set(directory, child);
      let errors = '';
      child.stdout?.on('data', chunk => { errors = (errors + chunk.toString()).slice(-4000); });
      child.stderr?.on('data', chunk => { errors = (errors + chunk.toString()).slice(-4000); });
      const temporary = statusFile + '.' + process.pid + '.tmp';
      writeFileSync(temporary, JSON.stringify({ state: 'installing', phase: 'starting', step: 0, pid: child.pid, message: 'Starting SDK runtime download', updatedAt: new Date().toISOString() }));
      renameSync(temporary, statusFile);
      child.once('error', error => { jobs.delete(directory); writeFailure(error.message); });
      child.once('close', code => {
        if (jobs.get(directory) === child) jobs.delete(directory);
        if (code !== 0 && !readManagedSensitiveDataRuntime(environment)) writeFailure(errors || 'Runtime installer exited with code ' + code);
      });
      return status();
    },
  };
}

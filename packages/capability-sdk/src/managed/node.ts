import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { realpath, rm, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createInstallProgress, advanceInstallProgress, type ManagedToolInstallProgress } from '../../runtime/managed/install-progress.cjs';
export { resolveToolModule, requireToolModule, importToolModule } from './modules.ts';
export type { ManagedToolInstallProgress, ManagedToolInstallStep } from '../../runtime/managed/install-progress.cjs';

export type ManagedToolDefinition = { id: string; title: string; description: string; group: string; runtime?: string; scope?: 'session' | 'run' };
export type ManagedToolStatus = ManagedToolDefinition & {
  state: 'missing' | 'installing' | 'ready' | 'failed' | 'cancelled'; phase: string; message: string; error?: string;
  version?: string; release?: string; packages?: string[]; updatedAt?: string; progress?: ManagedToolInstallProgress;
  jobId?: string; startedAt?: string; finishedAt?: string; heartbeatAt?: string; lastActivityAt?: string;
  logs?: string; download?: { receivedBytes: number; totalBytes: number }; cancelRequested?: boolean;
};
export type InstalledTool = { id: string; toolId: string; version: string; entry: string; args: string[];
  release: string; runtimeDirectory: string; dependencies: Record<string, string>;
  tools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown>; annotations?: { readOnlyHint?: boolean } }> };

const jobs = new Map<string, ChildProcess>();
function installerDirectory() {
  const candidates = [process.env.CAPABILITY_TOOL_INSTALLER_DIR,
    fileURLToPath(new URL('../../runtime/managed/', import.meta.url)),
    path.join(process.cwd(), 'capability-runtime', 'managed')];
  const found = candidates.find(value => value && existsSync(path.join(value, 'install-tool.cjs')));
  if (!found) throw new Error('The SDK tool installer is missing from this deployment.');
  return found;
}
function readJson<T>(filename: string): T | undefined {
  try { return JSON.parse(readFileSync(filename, 'utf8')) as T; } catch { return undefined; }
}
export function managedToolCatalog(): ManagedToolDefinition[] {
  return createRequire(import.meta.url)(path.join(installerDirectory(), 'tools.json')).tools;
}
export async function managedToolRuntimeConfiguration(id: string, config: Record<string, unknown>, projectRoot: string, environment: Readonly<Record<string, string | undefined>> = process.env): Promise<Record<string, string>> {
  const definition = managedToolCatalog().find(tool => tool.id === id);
  if (!definition) throw new Error('Unknown tool.');
  const helper = await import(pathToFileURL(path.resolve(installerDirectory(), '../../scripts/mcp-config.mjs')).href);
  helper.validateConfig(config);
  return helper.toolConfiguration(config, definition.group, projectRoot, environment);
}
export function minimalProcessEnvironment(source: NodeJS.ProcessEnv = process.env) {
  const allowed = /^(?:PATH|Path|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|LANG|LC_ALL|SSL_CERT_FILE|NODE_EXTRA_CA_CERTS|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)$/i;
  const npmCli = [source.CAPABILITY_NPM_CLI, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')].find(file => file && existsSync(file));
  return { ...Object.fromEntries(Object.entries(source).filter(([key, value]) => value !== undefined && allowed.test(key))),
    ...(npmCli ? { CAPABILITY_NPM_CLI: npmCli } : {}), ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}), NODE_ENV: 'production' } as NodeJS.ProcessEnv & Record<string, string>;
}
export function createManagedToolInstaller(input: { root: string; sdkRoot?: string; version?: string; registry?: string }) {
  const root = path.resolve(input.root);
  const ownSource = path.resolve(installerDirectory(), '../..');
  const sdkRoot = input.sdkRoot || (existsSync(path.join(ownSource, 'scripts/mcp-providers.mjs')) ? ownSource : undefined);
  function definition(id: string) {
    const tool = managedToolCatalog().find(item => item.id === id);
    if (!tool) throw new Error('请选择单个工具；不支持一次安装全部工具。');
    return tool;
  }
  const stateFile = (id: string) => path.join(root, '.state', id + '.json');
  const writeState = (id: string, state: unknown) => {
    const temporary = stateFile(id) + '.' + randomUUID() + '.tmp';
    writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 }); renameSync(temporary, stateFile(id));
  };
  function installed(id: string): InstalledTool | undefined {
    definition(id);
    const state = readJson<ManagedToolStatus>(stateFile(id));
    if (!state?.release) return;
    const release = path.resolve(state.release);
    const expected = path.join(root, 'packages', id) + path.sep;
    if (!release.startsWith(expected)) return;
    const record = readJson<InstalledTool>(path.join(release, 'component.json'));
    const entry = record && path.resolve(release, record.entry);
    if (!record || record.id !== id || !entry?.startsWith(release + path.sep) || !existsSync(entry)) return;
    return record;
  }
  function status(id: string): ManagedToolStatus {
    const tool = definition(id);
    const saved = readJson<ManagedToolStatus & { pid?: number }>(stateFile(id));
    if (installed(id)) return { ...tool, ...saved, state: 'ready', phase: 'ready', message: '已安装' };
    if (saved?.state === 'installing') {
      let alive = Boolean(jobs.get(root + ':' + id));
      if (!alive && saved.pid) { try { process.kill(saved.pid, 0); alive = true; } catch { /* interrupted install */ } }
      return alive ? { ...tool, ...saved, cancelRequested: readJson<{ jobId: string }>(path.join(root, '.state', id + '.cancel.json'))?.jobId === saved.jobId }
        : { ...tool, ...saved, state: 'failed', phase: 'failed', message: '安装已中断，可以重试',
        ...(saved.progress ? { progress: advanceInstallProgress(saved.progress, 'failed') } : {}) };
    }
    return saved ? { ...tool, ...saved, state: ['failed', 'cancelled'].includes(saved.state) ? saved.state : 'missing' }
      : { ...tool, state: 'missing', phase: 'missing', message: '未安装' };
  }
  return {
    root, status, installed,
    list: () => managedToolCatalog().map(tool => status(tool.id)),
    cancel(id: string, jobId: string) {
      const current = status(id);
      if (!jobId || current.jobId !== jobId) throw new Error('安装任务已更新，请刷新状态后重试。');
      if (current.state !== 'installing') return current;
      writeFileSync(path.join(root, '.state', id + '.cancel.json'), JSON.stringify({ jobId }), { mode: 0o600 });
      return { ...current, cancelRequested: true };
    },
    async check(id: string) {
      const tool = definition(id);
      const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
      const environment = minimalProcessEnvironment();
      checks.push({ name: 'npm', ok: Boolean(environment.CAPABILITY_NPM_CLI), detail: environment.CAPABILITY_NPM_CLI ? 'npm CLI is available' : 'The deployment needs the Node.js npm CLI' });
      try { mkdirSync(root, { recursive: true }); await access(root, constants.W_OK); checks.push({ name: 'storage', ok: true, detail: 'Tool directory is writable' }); }
      catch { checks.push({ name: 'storage', ok: false, detail: 'Tool directory is not writable' }); }
      if (tool.runtime) {
        try { createRequire(import.meta.url)(path.resolve(installerDirectory(), '../../scripts/runtime.cjs')).platformPlan(); checks.push({ name: 'platform', ok: true, detail: process.platform + '/' + process.arch }); }
        catch (error) { checks.push({ name: 'platform', ok: false, detail: String((error as Error).message) }); }
      }
      return { tool: status(id), readyToInstall: checks.every(check => check.ok), checks };
    },
    start(id: string, configuration: { env?: Record<string, string>; config?: Record<string, unknown> } = {}) {
      const before = status(id);
      if (before.state === 'ready' || before.state === 'installing') return before;
      const directory = path.join(root, '.state');
      mkdirSync(directory, { recursive: true });
      const jobId = randomUUID();
      const lock = path.join(directory, id + '.lock');
      for (let attempt = 0; ; attempt++) {
        try {
          const descriptor = openSync(lock, 'wx', 0o600);
          writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token: jobId })); closeSync(descriptor); break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt > 0) throw error;
          const owner = readJson<{ pid: number }>(lock);
          if (!owner?.pid) throw new Error('安装任务正在启动，请稍后刷新。');
          let alive = true; try { process.kill(owner.pid, 0); } catch { alive = false; }
          if (alive) throw new Error('安装任务仍在启动或结束，请稍后重试。');
          unlinkSync(lock);
        }
      }
      const request = path.join(directory, id + '-' + jobId + '.request.json');
      const initial: ManagedToolStatus & { pid?: number } = { ...definition(id), jobId, state: 'installing', phase: 'starting', message: '正在准备安装', progress: createInstallProgress(before), startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      let child: ChildProcess;
      try {
        writeFileSync(request, JSON.stringify({ ...input, ...configuration, sdkRoot, root, id, jobId }), { mode: 0o600 });
        writeState(id, initial);
        child = spawn(process.execPath, [path.join(installerDirectory(), 'install-tool.cjs'), request], {
          windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...minimalProcessEnvironment(), CAPABILITY_SKIP_RUNTIME_INSTALL: '1', npm_config_cache: path.join(root, '.cache', 'npm') },
        });
      } catch (error) {
        if (readJson<{ token: string }>(lock)?.token === jobId) unlinkSync(lock);
        void rm(request, { force: true });
        throw error;
      }
      const key = root + ':' + id;
      jobs.set(key, child);
      initial.pid = child.pid;
      if (readJson<ManagedToolStatus>(stateFile(id))?.phase === 'starting') {
        try { writeState(id, initial); } catch { /* The worker publishes its own PID on startup. */ }
      }
      let output = '';
      child.stdout?.setEncoding('utf8'); child.stderr?.setEncoding('utf8');
      const read = (chunk: string) => { output = (output + chunk).slice(-6000); };
      child.stdout?.on('data', read); child.stderr?.on('data', read);
      let finished = false;
      const finish = (error?: string) => {
        if (finished) return;
        finished = true;
        jobs.delete(key);
        void rm(request, { force: true });
        if (readJson<{ token: string }>(lock)?.token === jobId) { try { unlinkSync(lock); } catch { /* worker released it */ } }
        const latest = readJson<ManagedToolStatus>(stateFile(id));
        if (latest?.jobId !== jobId || ['ready', 'failed', 'cancelled'].includes(latest.state)) return;
        if (error || latest.state === 'installing') {
          const { redact } = createRequire(import.meta.url)(path.join(installerDirectory(), 'install-journal.cjs'));
          writeState(id, { ...initial, ...latest, state: 'failed', phase: 'failed', message: '安装失败，可以重试',
            progress: advanceInstallProgress(latest?.progress || initial.progress!, 'failed'), error: redact(error || 'Installer exited without a completed result.', Object.values(configuration.env || {})).slice(-4000), updatedAt: new Date().toISOString(), finishedAt: new Date().toISOString() });
        }
      };
      child.once('error', error => finish(error.message));
      child.once('close', (code, signal) => finish(code !== 0 ? output || 'Installer exited: ' + (signal || code) : undefined));
      return { ...initial, state: 'installing' as const };
    },
    async uninstall(id: string) {
      const tool = definition(id);
      if (status(id).state === 'installing') throw new Error('请等待安装完成后再卸载。');
      for (const area of ['packages', '.staging']) {
        const target = path.join(root, area, tool.id);
        if (existsSync(target)) {
          const actualRoot = await realpath(root), actual = await realpath(target);
          if (!actual.startsWith(path.join(actualRoot, area) + path.sep)) throw new Error('工具目录不在组件工作区内。');
          await rm(target, { recursive: true, force: true });
        }
      }
      await rm(path.join(root, '.state', tool.id + '.cancel.json'), { force: true });
      await rm(stateFile(id), { force: true });
      return status(id);
    },
  };
}

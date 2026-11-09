import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
export { resolveToolModule, requireToolModule, importToolModule } from './modules.ts';

export type ManagedToolDefinition = { id: string; title: string; description: string; group: string; runtime?: string; scope?: 'session' | 'run' };
export type ManagedToolStatus = ManagedToolDefinition & {
  state: 'missing' | 'installing' | 'ready' | 'failed'; phase: string; message: string; error?: string;
  version?: string; release?: string; packages?: string[]; updatedAt?: string;
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
      return alive ? { ...tool, ...saved } : { ...tool, ...saved, state: 'failed', phase: 'failed', message: '安装已中断，可以重试' };
    }
    return saved ? { ...tool, ...saved, state: saved.state === 'failed' ? 'failed' : 'missing' }
      : { ...tool, state: 'missing', phase: 'missing', message: '未安装' };
  }
  return {
    root, status, installed,
    list: () => managedToolCatalog().map(tool => status(tool.id)),
    start(id: string, configuration: { env?: Record<string, string>; config?: Record<string, unknown> } = {}) {
      const before = status(id);
      if (before.state === 'ready' || before.state === 'installing') return before;
      const directory = path.join(root, '.state');
      mkdirSync(directory, { recursive: true });
      const request = path.join(directory, id + '-' + randomUUID() + '.request.json');
      writeFileSync(request, JSON.stringify({ ...input, ...configuration, sdkRoot, root, id }), { mode: 0o600 });
      const child: ChildProcess = spawn(process.execPath, [path.join(installerDirectory(), 'install-tool.cjs'), request], {
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...minimalProcessEnvironment(), CAPABILITY_SKIP_RUNTIME_INSTALL: '1', npm_config_cache: path.join(root, '.cache', 'npm') },
      });
      const key = root + ':' + id;
      jobs.set(key, child);
      const initial = { ...before, state: 'installing', phase: 'starting', message: '正在准备安装', pid: child.pid, updatedAt: new Date().toISOString() };
      const temporary = stateFile(id) + '.' + randomUUID() + '.tmp';
      writeFileSync(temporary, JSON.stringify(initial)); renameSync(temporary, stateFile(id));
      let output = '';
      const read = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-6000); };
      child.stdout?.on('data', read); child.stderr?.on('data', read);
      let finished = false;
      const finish = (error?: string) => {
        if (finished) return;
        finished = true;
        jobs.delete(key);
        void rm(request, { force: true });
        if (error && status(id).state !== 'ready') {
          const temporary = stateFile(id) + '.' + randomUUID() + '.tmp';
          writeFileSync(temporary, JSON.stringify({ ...before, state: 'failed', phase: 'failed', message: '安装失败，可以重试', error: error.slice(-4000), updatedAt: new Date().toISOString() }));
          renameSync(temporary, stateFile(id));
        }
      };
      child.once('error', error => finish(error.message));
      child.once('close', code => finish(code ? output || 'Installer exited with code ' + code : undefined));
      return { ...before, state: 'installing' as const, phase: 'starting', message: '正在准备安装' };
    },
    async uninstall(id: string) {
      const tool = definition(id);
      if (status(id).state === 'installing') throw new Error('请等待安装完成后再卸载。');
      const target = path.join(root, 'packages', tool.id);
      if (existsSync(target)) {
        const actualRoot = await realpath(root), actual = await realpath(target);
        if (!actual.startsWith(path.join(actualRoot, 'packages') + path.sep)) throw new Error('工具目录不在组件工作区内。');
        await rm(target, { recursive: true, force: true });
      }
      await rm(stateFile(id), { force: true });
      return status(id);
    },
  };
}

#!/usr/bin/env node
// This bootstrap deliberately imports only Node built-ins: it also works before npm install.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';

const packageName = '@cjfclonedeep/capability-sdk';
const help = `Usage: capability-setup [--project <directory>] [--clients all] [--scope user]
  --package <npm-spec|file.tgz>  Install/upgrade from an explicit prepared SDK package.
  --clients <list>              all (default), cursor,codex,claude-code,claude-desktop,vscode,windsurf,devin
  --scope <user|project>        user by default; desktop-only clients are skipped in project scope.
  --tools <groups>              Select exposed tools (default: supported local tools).
  --config <file>               Existing tool JSON or explicit .mjs provider configuration.
  --name <name>                 Client server name (default: capability-sdk).
  --skill-mode <eager|lazy>     Tool instruction mode.
  --dry-run                    Preview only: no downloads, installs, or configuration writes.
Requires Node.js >=22.16 and npm. Installs SDK dependencies and managed runtimes,
then merges client configurations with backups. Never starts/builds the Orbit app.
An existing SDK is reused unless --package is supplied. Applications are not installed.
`;

function run(command, args, cwd, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit', windowsHide: true, shell: false });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} failed (${code}).`)));
  });
}

async function npmEntry() {
  const candidates = [process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    candidates.push(path.join(directory.replace(/^"|"$/g, ''), 'node_modules', 'npm', 'bin', 'npm-cli.js'));
    const launcher = path.join(directory, 'npm');
    try { candidates.push(await realpath(launcher)); } catch { /* Not an npm installation. */ }
  }
  const entry = candidates.find(candidate => candidate && candidate.endsWith('npm-cli.js') && existsSync(candidate));
  if (!entry) throw new Error('npm-cli.js was not found. Install Node.js with npm, or launch this script through npm exec.');
  return entry;
}

async function readPackage(filename) {
  try { return JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    project: { type: 'string' }, package: { type: 'string' }, clients: { type: 'string' }, scope: { type: 'string' },
    tools: { type: 'string' }, config: { type: 'string' }, name: { type: 'string' }, 'skill-mode': { type: 'string' },
    'dry-run': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) { console.log(help); return; }
  if (positionals.length) throw new Error('Unexpected positional arguments. Use --help.');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 16)) throw new Error('Node.js >=22.16 is required.');
  if (values.scope && !['user', 'project'].includes(values.scope)) throw new Error('--scope must be user or project.');
  const projectRoot = path.resolve(values.project || process.env.CAPABILITY_PROJECT_DIR || process.cwd());
  const installedRoot = path.join(projectRoot, 'node_modules', '@cjfclonedeep', 'capability-sdk');
  const workspaceRoot = path.join(projectRoot, 'packages', 'capability-sdk');
  let sdkRoot;
  for (const candidate of [workspaceRoot, installedRoot]) {
    if ((await readPackage(path.join(candidate, 'package.json')))?.name === packageName) { sdkRoot = candidate; break; }
  }
  const ownManifest = await readPackage(fileURLToPath(new URL('../package.json', import.meta.url)));
  let spec = values.package || `${packageName}@${ownManifest.version}`;
  if (spec.startsWith('-')) throw new Error('--package must be a package specifier, not an npm option.');
  if (existsSync(path.resolve(spec))) {
    spec = path.resolve(spec);
    if (!(await stat(spec)).isFile() || !spec.endsWith('.tgz')) throw new Error('--package local sources must be prepared .tgz files, not source directories.');
  } else if (!spec.startsWith(`${packageName}@`) && spec !== packageName) {
    throw new Error(`Use --package ${packageName}@<version> or the path to a prepared .tgz file.`);
  }
  const install = values.package !== undefined || !sdkRoot;
  const args = ['setup', '--project', projectRoot];
  for (const key of ['clients', 'scope', 'tools', 'config', 'name', 'skill-mode']) if (values[key] !== undefined) args.push(`--${key}`, values[key]);
  if (values['dry-run']) args.push('--dry-run');
  console.error(`Tool project: ${projectRoot}`);
  if (install) {
    console.error(`${values['dry-run'] ? 'Would install' : 'Installing'} ${spec}`);
    if (values['dry-run']) {
      console.error(`Then: capability-mcp ${args.join(' ')}. Client file validation runs after the SDK is available.`);
      return;
    }
    // Installing a package into the Orbit workspace would replace its local workspace link.
    if ((await readPackage(path.join(projectRoot, 'package.json')))?.workspaces) {
      throw new Error('For a downloaded SDK, choose a separate --project directory outside the Orbit workspace.');
    }
    const npm = await npmEntry();
    await mkdir(projectRoot, { recursive: true });
    if (!existsSync(path.join(projectRoot, 'package.json'))) {
      await writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({ name: 'capability-tools', version: '1.0.0', private: true, type: 'module' }, null, 2) + '\n', { flag: 'wx' });
    }
    // Keep dependency lifecycle scripts enabled; only defer our large runtime download until preflight passes.
    try {
      await run(process.execPath, [npm, 'install', '--save-exact', '--foreground-scripts', '--no-audit', '--no-fund', spec], projectRoot,
        { ...process.env, CAPABILITY_SKIP_RUNTIME_INSTALL: '1' });
    } catch (error) {
      throw new Error(`${error.message} If this version is unpublished, pass --package with a prepared SDK .tgz; setup does not build source.`);
    }
    sdkRoot = installedRoot;
  }
  if (!existsSync(path.join(sdkRoot, 'scripts', 'mcp-clients.mjs'))) {
    throw new Error('The installed SDK predates unified setup. Use --package with a release containing setup, or a prepared .tgz. Existing local patches were not overwritten.');
  }
  if (!existsSync(path.join(sdkRoot, 'dist', 'adapters', 'mcp', 'index.js'))) {
    throw new Error('SDK dist is missing. Use a prepared SDK release package; no build was run.');
  }
  const manifest = await readPackage(path.join(sdkRoot, 'package.json'));
  const resolve = createRequire(path.join(sdkRoot, 'package.json'));
  const missingDependencies = () => Object.keys(manifest.dependencies || {}).filter(name => {
    try { resolve.resolve(name); return false; } catch (error) { return error.code === 'MODULE_NOT_FOUND'; }
  });
  const missing = missingDependencies();
  if (missing.length) {
    console.error(`${values['dry-run'] ? 'Would install' : 'Installing'} missing SDK dependencies: ${missing.join(', ')}`);
    if (values['dry-run']) {
      console.error('Then install tool runtimes and merge client configurations. No files changed.');
      return;
    }
    const workspace = path.resolve(sdkRoot) === path.resolve(workspaceRoot);
    const npm = await npmEntry();
    await run(process.execPath, [npm, 'install', ...(workspace ? ['--workspace', packageName] : []),
      '--foreground-scripts', '--no-audit', '--no-fund'], projectRoot, { ...process.env, CAPABILITY_SKIP_RUNTIME_INSTALL: '1' });
    if (missingDependencies().length) throw new Error('SDK dependency installation is incomplete; retry setup.');
  }
  await run(process.execPath, [path.join(sdkRoot, 'scripts', 'mcp.mjs'), ...args], projectRoot);
}

main().catch(error => { console.error(`[capability-setup] ${error.message}`); process.exitCode = 1; });

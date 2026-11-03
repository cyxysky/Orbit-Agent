#!/usr/bin/env node
// Standalone bootstrap: only Node built-ins; no source build or app server.
import path from 'node:path';
import os from 'node:os';
import { existsSync, createWriteStream, constants } from 'node:fs';
import { realpath, mkdtemp, mkdir, copyFile, readFile, unlink, rmdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';

const packageName = '@cjfclonedeep/capability-sdk';
const defaultVersion = '0.3.10';
const releaseRoot = 'https://github.com/cyxysky/capability-sdk/releases/download';
const help = `Install Capability SDK and connect it to your existing agents.
Usage: node install.mjs [options]
  --project <directory>   Tool workspace (default: ~/.capability-tools).
  --version <version>     Prepared npm release (default: ${defaultVersion}).
  --clients <list>        all, cursor,codex,claude-code,claude-desktop,vscode,windsurf,devin.
  --scope <user|project>  Client configuration scope (default: user).
  --tools <groups>        Tool groups to expose; runtime setup currently prepares all local runtimes.
  --config <file>         Existing SDK configuration.
  --name <name>           MCP connection name.
  --skill-mode <mode>     eager or lazy.
  --dry-run              Print the plan without downloads or file changes.
  --help                 Show this help.
Requires Node.js >=22.16 and npm. First runtime setup can download several GB.
The release must include capability-setup; npm 0.3.0 does not include it.
Uses the matching npm release when available, otherwise the verified GitHub Release package.
`;

async function npmEntry() {
  const candidates = [process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    const directoryPath = directory.replace(/^"|"$/g, '');
    candidates.push(path.join(directoryPath, 'node_modules', 'npm', 'bin', 'npm-cli.js'));
    try { candidates.push(await realpath(path.join(directoryPath, 'npm'))); } catch { /* Try the next PATH entry. */ }
  }
  const entry = candidates.find(candidate => candidate?.endsWith('npm-cli.js') && existsSync(candidate));
  if (!entry) throw new Error('npm was not found. Install Node.js with npm and run again.');
  return entry;
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    project: { type: 'string' }, version: { type: 'string' }, clients: { type: 'string' }, scope: { type: 'string' },
    tools: { type: 'string' }, config: { type: 'string' }, name: { type: 'string' }, 'skill-mode': { type: 'string' },
    'dry-run': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) { console.log(help); return; }
  if (positionals.length) throw new Error('Unexpected arguments. Use --help.');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 16)) throw new Error('Node.js >=22.16 is required.');
  const version = values.version || process.env.CAPABILITY_INSTALL_VERSION || defaultVersion;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('--version must be an exact release version, such as 0.3.1.');
  if (version === '0.3.0' || /^0\.[12]\./.test(version)) throw new Error('This release does not include the unified installer. Use 0.3.1 or a later release.');
  if (values.scope && !['user', 'project'].includes(values.scope)) throw new Error('--scope must be user or project.');
  if (values['skill-mode'] && !['eager', 'lazy'].includes(values['skill-mode'])) throw new Error('--skill-mode must be eager or lazy.');
  const allowedClients = ['cursor', 'codex', 'claude-code', 'claude-desktop', 'vscode', 'windsurf', 'devin'];
  const clients = values.clients || 'all';
  if (clients !== 'all' && clients.split(',').some(client => !allowedClients.includes(client.trim()))) throw new Error('Unknown client. Use --help for supported clients.');
  const project = path.resolve(values.project || process.env.CAPABILITY_PROJECT_DIR || path.join(os.homedir(), '.capability-tools'));
  const spec = `${packageName}@${version}`;
  const argsFor = source => {
    const args = ['exec', '--yes', '--package', source, '--', 'capability-setup', '--project', project, '--package', source, '--clients', clients];
    for (const key of ['scope', 'tools', 'config', 'name', 'skill-mode']) if (values[key] !== undefined) args.push(`--${key}`, values[key]);
    return args;
  };
  const filename = `cjfclonedeep-capability-sdk-${version}.tgz`;
  const releaseUrl = `${releaseRoot}/v${version}/${filename}`;
  console.error(`Release: ${spec}\nTool workspace: ${project}\nMCP clients: ${clients}`);
  if (values['dry-run']) {
    console.log(JSON.stringify({ executable: process.execPath, npmArguments: argsFor(spec), githubFallback: releaseUrl, checksum: `${releaseUrl}.sha256`, runtimeInstallDeferredDuringBootstrap: true }, null, 2));
    return;
  }
  const npm = await npmEntry();
  let packageSource = spec;
  let temporaryDirectory;
  let temporaryPackage;
  try {
    const metadata = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/${version}`, { signal: AbortSignal.timeout(15000) })
      .then(async response => response.ok ? response.json() : null).catch(() => null);
    if (!metadata?.bin?.['capability-setup']) {
      console.error(`npm release not available; using GitHub Release v${version}.`);
      const checksumResponse = await fetch(`${releaseUrl}.sha256`, { signal: AbortSignal.timeout(30000) });
      if (!checksumResponse.ok) throw new Error(`Release v${version} is not ready (checksum HTTP ${checksumResponse.status}). Check https://github.com/cyxysky/capability-sdk/releases before installing.`);
      const checksum = (await checksumResponse.text()).trim().split(/\s+/)[0];
      if (!/^[a-f0-9]{64}$/i.test(checksum)) throw new Error('The release SHA-256 checksum is invalid.');
      const response = await fetch(releaseUrl, { signal: AbortSignal.timeout(180000) });
      if (!response.ok || !response.body) throw new Error(`Release download failed (HTTP ${response.status}).`);
      temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'capability-release-'));
      temporaryPackage = path.join(temporaryDirectory, filename);
      const hash = createHash('sha256');
      await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, encoding, callback) {
        hash.update(chunk); callback(null, chunk);
      } }), createWriteStream(temporaryPackage, { flags: 'wx' }));
      if (hash.digest('hex').toLowerCase() !== checksum.toLowerCase()) throw new Error('Release checksum mismatch. The package was not installed.');
      // npm records local archives in package.json and package-lock.json. Keep
      // the verified archive so a later npm install/ci can resolve that source.
      const packageCache = path.join(project, '.capability-sdk', 'packages');
      await mkdir(packageCache, { recursive: true });
      packageSource = path.join(packageCache, `${checksum.toLowerCase()}-${filename}`);
      try { await copyFile(temporaryPackage, packageSource, constants.COPYFILE_EXCL); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const cachedHash = createHash('sha256').update(await readFile(packageSource)).digest('hex');
        if (cachedHash !== checksum.toLowerCase()) throw new Error('The cached release package has a different checksum.');
      }
    }
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [npm, ...argsFor(packageSource)], {
        cwd: process.cwd(), stdio: 'inherit', windowsHide: true, shell: false,
        // npm exec's cache is not the final project. setup installs runtimes only after config preflight.
        env: { ...process.env, CAPABILITY_SKIP_RUNTIME_INSTALL: '1' },
      });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Installation exited with ${code}. You can rerun this installer; existing MCP connections are backed up and merged.`)));
    });
  } finally {
    if (temporaryPackage) await unlink(temporaryPackage).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (temporaryDirectory) await rmdir(temporaryDirectory);
  }
  console.error('Installation complete. Reload your agent client and enable the capability-sdk MCP connection.');
}

main().catch(error => { console.error(`[capability-install] ${error.message}`); process.exitCode = 1; });

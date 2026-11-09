const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { packageTool } = require('./package-tool.cjs');
const catalog = require('./tools.json').tools;

async function removeWithin(root, target) {
  const actualRoot = await fsp.realpath(root);
  const resolved = path.resolve(target);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error('Cleanup escapes the component workspace.');
  if (!fs.existsSync(resolved)) return;
  const actual = await fsp.realpath(resolved);
  if (!actual.startsWith(actualRoot + path.sep)) throw new Error('Cleanup follows a link outside the component workspace.');
  await fsp.rm(resolved, { recursive: true, force: true });
}

function npmCli() {
  return [process.env.CAPABILITY_NPM_CLI, process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')]
    .find(file => file && path.basename(file) === 'npm-cli.js' && fs.existsSync(file));
}
async function execute(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let output = '';
    const read = chunk => { output = (output + chunk.toString()).slice(-12000); process.stderr.write(chunk); };
    child.stdout.on('data', read); child.stderr.on('data', read);
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(output) : reject(new Error('Tool installation command failed (' + code + '): ' + output)));
  });
}
async function installTool({ root, id, sdkRoot, env = {}, config = {}, version = '0.3.0', registry = 'https://registry.npmjs.org' }) {
  const tool = catalog.find(item => item.id === id);
  if (!tool) throw new Error('Choose one known tool id. Installing all tools is not supported.');
  root = path.resolve(root);
  const stateDirectory = path.join(root, '.state');
  await fsp.mkdir(stateDirectory, { recursive: true });
  const statusFile = path.join(stateDirectory, id + '.json');
  const lock = path.join(stateDirectory, id + '.lock');
  const token = randomUUID();
  const stage = path.join(root, '.staging', id + '-' + token);
  const state = (phase, message, extra = {}) => {
    const value = { id, state: 'installing', phase, message, pid: process.pid, token, updatedAt: new Date().toISOString(), ...extra };
    const temporary = statusFile + '.' + token + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(temporary, statusFile);
  };
  try {
    const fd = fs.openSync(lock, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token })); fs.closeSync(fd);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = JSON.parse(fs.readFileSync(lock, 'utf8'));
    try { process.kill(owner.pid, 0); throw new Error('This tool already has an installation in progress.'); }
    catch (alive) { if (alive.code !== 'ESRCH') throw alive; }
    fs.unlinkSync(lock);
    return installTool({ root, id, sdkRoot, env, config, version, registry });
  }
  try {
    await fsp.mkdir(stage, { recursive: true });
    state('source', '正在准备此工具的 SDK 源码');
    const cli = npmCli();
    if (!cli) throw new Error('The Node.js npm CLI is required to install a tool.');
    if (!sdkRoot || !fs.existsSync(path.join(sdkRoot, 'scripts', 'mcp-providers.mjs'))) {
      const source = path.join(stage, '.source');
      await fsp.mkdir(source, { recursive: true });
      const response = await fetch(registry.replace(/\/$/, '') + '/@cjfclonedeep%2fcapability-sdk/' + encodeURIComponent(version), { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('SDK release metadata is unavailable: HTTP ' + response.status);
      const metadata = await response.json();
      if (!metadata.dist?.tarball || !metadata.dist?.integrity) throw new Error('SDK release has no integrity-protected archive.');
      const archive = await fetch(metadata.dist.tarball, { signal: AbortSignal.timeout(180000) });
      if (!archive.ok) throw new Error('SDK download failed: HTTP ' + archive.status);
      const chunks = []; let length = 0;
      for await (const chunk of archive.body) {
        length += chunk.length;
        if (length > 256 * 1024 * 1024) throw new Error('SDK archive exceeds its size limit.');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      const integrity = metadata.dist.integrity.split(' ').find(value => value.startsWith('sha512-'));
      if (!integrity || createHash('sha512').update(bytes).digest('base64') !== integrity.slice(7)) throw new Error('SDK release integrity verification failed.');
      const tar = createRequire(cli)('tar');
      const unpack = tar.x({ cwd: source, strip: 1, strict: true, preservePaths: false,
        filter: (_name, entry) => !['SymbolicLink', 'Link', 'CharacterDevice', 'BlockDevice', 'FIFO'].includes(entry.type) });
      await new Promise((resolve, reject) => { unpack.once('error', reject); unpack.once('close', resolve); unpack.end(bytes); });
      sdkRoot = source;
    }
    state('graph', '正在收集此工具的模块和依赖');
    const packaged = await packageTool({ sdkRoot, output: stage, tool });
    const sharedRuntime = path.resolve(env.CAPABILITY_RUNTIME_HOME || path.join(root, 'runtime', process.platform + '-' + process.arch));
    const runtimeBefore = require('./layout.cjs').readManagedRuntime({ CAPABILITY_RUNTIME_HOME: sharedRuntime });
    // The installer and catalog from this release govern runtime provisioning.
    for (const file of ['runtime.cjs']) fs.copyFileSync(path.resolve(__dirname, '../../scripts', file), path.join(stage, 'sdk/scripts', file));
    for (const file of ['layout.cjs', 'spec.json', 'linux-system.cjs']) if (fs.existsSync(path.join(__dirname, file))) fs.copyFileSync(path.join(__dirname, file), path.join(stage, 'sdk/runtime/managed', file));
    state('dependencies', '正在安装 ' + tool.title + ' 的独立依赖', { packages: Object.keys(packaged.dependencies) });
    await execute(process.execPath, [cli, 'install', '--prefix', stage, '--omit=dev', '--no-audit', '--no-fund', '--registry', registry], {
      cwd: stage, env: { ...process.env, ...Object.fromEntries(Object.entries(env).filter(([key]) => /^(?:FFMPEG_BINARIES_URL|FFMPEG_BINARY_RELEASE|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)$/i.test(key))),
        ...(runtimeBefore?.ffmpeg ? { FFMPEG_BIN: runtimeBefore.ffmpeg } : {}),
        CAPABILITY_SKIP_RUNTIME_INSTALL: '1', ELECTRON_SKIP_BINARY_DOWNLOAD: '1', PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
    });
    const excluded = require('./tools.json').excludedOptionalPackages || [];
    async function prune(directory) {
      if (!fs.existsSync(directory)) return;
      for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const filename = path.join(directory, entry.name);
        if (entry.name.startsWith('@')) { await prune(filename); continue; }
        let name;
        try { name = JSON.parse(await fsp.readFile(path.join(filename, 'package.json'), 'utf8')).name; } catch { continue; }
        if (excluded.some(item => name === item || name.startsWith(item + '-'))) await removeWithin(stage, filename);
        else await prune(path.join(filename, 'node_modules'));
      }
    }
    await prune(path.join(stage, 'node_modules'));
    if (tool.runtime) {
      state('runtime', '正在准备 ' + tool.title + ' 所需的运行环境');
      await execute(process.execPath, [path.join(stage, 'sdk/scripts/runtime.cjs'), 'install', tool.runtime], {
        cwd: stage, env: { ...process.env, ...env, CAPABILITY_SKIP_RUNTIME_INSTALL: '0', CAPABILITY_RUNTIME_HOME: sharedRuntime },
      });
    }
    const runtimeAfter = require('./layout.cjs').readManagedRuntime({ CAPABILITY_RUNTIME_HOME: sharedRuntime });
    if (packaged.dependencies['ffmpeg-static'] && runtimeAfter?.ffmpeg) {
      const binary = path.join(stage, 'node_modules/ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
      await fsp.rm(binary, { force: true });
      try { await fsp.link(runtimeAfter.ffmpeg, binary); }
      catch (error) { if (error.code !== 'EXDEV') throw error; await fsp.copyFile(runtimeAfter.ffmpeg, binary); }
    }
    state('verify', '正在校验工具入口');
    const entry = path.join(stage, packaged.entry);
    if (!fs.existsSync(entry)) throw new Error('Installed MCP entry is missing.');
    const probeDirectory = path.join(stage, '.verification');
    await fsp.mkdir(probeDirectory, { recursive: true });
    const configurationFile = path.join(probeDirectory, 'config.json');
    fs.writeFileSync(configurationFile, JSON.stringify(config), { mode: 0o600 });
    const { createMCPClient } = await import('@ai-sdk/mcp');
    const { createStdioTransport } = require('./stdio-transport.cjs');
    const transport = createStdioTransport({ command: process.execPath,
      args: [entry, ...packaged.args, '--project', probeDirectory], cwd: stage, stderr: 'ignore',
      env: { ...process.env, ...env, CAPABILITY_RUNTIME_HOME: sharedRuntime, CAPABILITY_TOOL_CONFIG_FILE: configurationFile } });
    let client, tools;
    try {
      client = await createMCPClient({ transport, clientName: 'capability-installer', maxRetries: 0,
        initializationOptions: { timeout: 30000 } });
      tools = (await client.listTools({ options: { signal: AbortSignal.timeout(30000) } })).tools;
      if (!tools.length) throw new Error('The MCP component did not expose any tools.');
    } finally { if (client) await client.close(); else await transport.close(); }
    // Installation paths never contain npm file: links into the staging directory.
    const release = path.join(root, 'packages', id, token);
    await fsp.mkdir(path.dirname(release), { recursive: true });
    await removeWithin(stage, path.join(stage, '.source'));
    await removeWithin(stage, probeDirectory);
    const installed = { ...packaged, tools, id, release, installedAt: new Date().toISOString(), runtimeDirectory: sharedRuntime };
    fs.writeFileSync(path.join(stage, 'component.json'), JSON.stringify(installed, null, 2));
    for (let attempt = 0; ; attempt++) {
      try { await fsp.rename(stage, release); break; }
      catch (error) {
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 8) throw error;
        await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    state('ready', '工具已安装', { state: 'ready', release, version: packaged.version, packages: Object.keys(packaged.dependencies) });
    return installed;
  } catch (error) {
    state('failed', '工具安装失败，可以重试', { state: 'failed', error: String(error.message || error).slice(-4000) });
    throw error;
  } finally {
    const owner = JSON.parse(fs.readFileSync(lock, 'utf8'));
    if (owner.token === token) await fsp.unlink(lock);
    if (fs.existsSync(stage)) await removeWithin(root, stage);
  }
}
module.exports = { installTool, npmCli };
if (require.main === module) {
  const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  installTool(input).catch(error => { console.error(error.message); process.exitCode = 1; });
}

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { packageTool } = require('./package-tool.cjs');
const catalog = require('./tools.json').tools;
const { createInstallJournal } = require('./install-journal.cjs');

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
  const { signal, journal, ...spawnOptions } = options;
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], ...spawnOptions });
    let output = '';
    const terminate = force => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.once('error', () => child.kill());
      } else { try { process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM'); } catch { child.kill(); } }
    };
    let reason, forceTimer;
    const stop = error => { if (reason) return; reason = error; terminate(false); forceTimer = setTimeout(() => terminate(true), 5000); };
    const abort = () => stop(signal.reason || new Error('Installation cancelled.'));
    const timer = setTimeout(() => stop(new Error('Installation command timed out after 30 minutes.')), 30 * 60_000);
    const line = text => {
      if (text.startsWith('@@capability-progress@@')) {
        try { journal?.progress(JSON.parse(text.slice(23))); return; } catch { /* preserve invalid output */ }
      }
      journal?.output(text + '\n');
      output = (output + text + '\n').slice(-12000);
    };
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8');
      let pending = '';
      stream.on('data', chunk => {
        pending += chunk;
        const lines = pending.split(/[\r\n]/); pending = lines.pop();
        for (const text of lines) if (text) line(text);
        if (pending.length > 64000) { line(pending); pending = ''; }
      });
      stream.on('end', () => { if (pending) line(pending); });
    }
    const cleanup = () => { clearTimeout(timer); clearTimeout(forceTimer); signal?.removeEventListener('abort', abort); };
    signal?.addEventListener('abort', abort, { once: true });
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', code => { cleanup(); reason ? reject(reason) : code === 0 ? resolve(output) : reject(new Error('Tool installation command failed (' + code + '): ' + output)); });
    if (signal?.aborted) abort();
  });
}
async function installTool({ root, id, sdkRoot, env = {}, config = {}, jobId = randomUUID(), version = '0.3.0', registry = 'https://registry.npmjs.org' }) {
  const tool = catalog.find(item => item.id === id);
  if (!tool) throw new Error('Choose one known tool id. Installing all tools is not supported.');
  // Tool credentials may reach its verification process; loader controls and
  // install destinations always belong to the trusted deployment environment.
  env = Object.fromEntries(Object.entries(env).filter(([key]) => !/^(?:NODE_|PYTHON|LD_|DYLD_|CAPABILITY_|ELECTRON_|npm_|BASH_ENV$|ENV$|PATH$|PATHEXT$|COMSPEC$)/i.test(key)));
  root = path.resolve(root);
  const stateDirectory = path.join(root, '.state');
  await fsp.mkdir(stateDirectory, { recursive: true });
  const lock = path.join(stateDirectory, id + '.lock');
  const token = jobId;
  const stage = path.join(root, '.staging', id);
  const controller = new AbortController();
  let journal;
  const state = (...args) => journal.state(...args);
  try {
    const fd = fs.openSync(lock, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token })); fs.closeSync(fd);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = JSON.parse(fs.readFileSync(lock, 'utf8'));
    if (owner.token === token) fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, token }), { mode: 0o600 });
    else {
    try { process.kill(owner.pid, 0); throw new Error('This tool already has an installation in progress.'); }
    catch (alive) { if (alive.code !== 'ESRCH') throw alive; }
    fs.unlinkSync(lock);
    return installTool({ root, id, sdkRoot, env, config, version, registry, jobId });
    }
  }
  journal = createInstallJournal({ root, tool, jobId, signal: controller, secrets: [...Object.values(env), registry] });
  const run = (command, args, options = {}) => execute(command, args, { ...options, signal: controller.signal, journal });
  try {
    await fsp.mkdir(stage, { recursive: true });
    if (!(await fsp.realpath(stage)).startsWith((await fsp.realpath(root)) + path.sep)) throw new Error('Tool staging escapes its workspace.');
    state('source', '正在准备此工具的 SDK 源码');
    const cli = npmCli();
    if (!cli) throw new Error('The Node.js npm CLI is required to install a tool.');
    if (!sdkRoot || !fs.existsSync(path.join(sdkRoot, 'scripts', 'mcp-providers.mjs'))) {
      state('source', '正在获取 SDK 下载信息');
      const cached = path.join(stage, '.source');
      if (fs.existsSync(path.join(cached, 'scripts/mcp-providers.mjs'))) sdkRoot = cached;
    }
    if (!sdkRoot || !fs.existsSync(path.join(sdkRoot, 'scripts', 'mcp-providers.mjs'))) {
      const { fetch: proxyFetch, EnvHttpProxyAgent } = require('undici');
      const dispatcher = new EnvHttpProxyAgent();
      try {
      const response = await proxyFetch(registry.replace(/\/$/, '') + '/@cjfclonedeep%2fcapability-sdk/' + encodeURIComponent(version), { dispatcher, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
      if (!response.ok) throw new Error('SDK release metadata is unavailable: HTTP ' + response.status);
      const metadata = await response.json();
      if (!metadata.dist?.tarball || !metadata.dist?.integrity) throw new Error('SDK release has no integrity-protected archive.');
      state('source', '正在下载 SDK 源码');
      const archive = await proxyFetch(metadata.dist.tarball, { dispatcher, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]) });
      if (!archive.ok) throw new Error('SDK download failed: HTTP ' + archive.status);
      const chunks = []; let length = 0;
      for await (const chunk of archive.body) {
        length += chunk.length;
        if (length > 256 * 1024 * 1024) throw new Error('SDK archive exceeds its size limit.');
        chunks.push(chunk);
        journal.progress({ message: '正在下载 SDK 源码', download: { receivedBytes: length, totalBytes: Number(archive.headers.get('content-length')) || 0 } });
      }
      const bytes = Buffer.concat(chunks);
      const integrity = metadata.dist.integrity.split(' ').find(value => value.startsWith('sha512-'));
      if (!integrity || createHash('sha512').update(bytes).digest('base64') !== integrity.slice(7)) throw new Error('SDK release integrity verification failed.');
      state('source', '正在解压并校验 SDK 源码');
      const tar = createRequire(cli)('tar');
      const source = path.join(stage, '.source'); await fsp.mkdir(source, { recursive: true });
      const unpack = tar.x({ cwd: source, strip: 1, strict: true, preservePaths: false,
        filter: (_name, entry) => !['SymbolicLink', 'Link', 'CharacterDevice', 'BlockDevice', 'FIFO'].includes(entry.type) });
      await new Promise((resolve, reject) => { unpack.once('error', reject); unpack.once('close', resolve); unpack.end(bytes); });
      sdkRoot = source;
      } finally { await dispatcher.close(); }
    }
    state('graph', '正在收集此工具的模块和依赖');
    const packaged = await packageTool({ sdkRoot, output: stage, tool });
    const sharedRuntime = path.join(root, 'runtime', process.platform + '-' + process.arch);
    const runtimeBefore = require('./layout.cjs').readManagedRuntime({ CAPABILITY_RUNTIME_HOME: sharedRuntime });
    // The installer and catalog from this release govern runtime provisioning.
    for (const file of ['runtime.cjs']) fs.copyFileSync(path.resolve(__dirname, '../../scripts', file), path.join(stage, 'sdk/scripts', file));
    for (const file of ['layout.cjs', 'spec.json', 'linux-system.cjs']) if (fs.existsSync(path.join(__dirname, file))) fs.copyFileSync(path.join(__dirname, file), path.join(stage, 'sdk/runtime/managed', file));
    state('dependencies', '正在安装 ' + tool.title + ' 的独立依赖', { packages: Object.keys(packaged.dependencies) });
    await run(process.execPath, [cli, 'install', '--prefix', stage, '--omit=dev', '--no-audit', '--no-fund', '--prefer-offline', '--loglevel=http', '--registry', registry], {
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
      await run(process.execPath, [path.join(stage, 'sdk/scripts/runtime.cjs'), 'install', tool.runtime], {
        cwd: stage, env: { ...process.env, ...env, CAPABILITY_INSTALL_PROGRESS: '1', CAPABILITY_SKIP_RUNTIME_INSTALL: '0', CAPABILITY_RUNTIME_HOME: sharedRuntime },
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
      controller.signal.throwIfAborted();
      tools = (await client.listTools({ options: { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) } })).tools;
      if (!tools.length) throw new Error('The MCP component did not expose any tools.');
    } finally { if (client) await client.close(); else await transport.close(); }
    // Installation paths never contain npm file: links into the staging directory.
    state('publish', '正在保存工具并清理安装临时文件');
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
    state('ready', '工具已安装', { state: 'ready', release, version: packaged.version, packages: Object.keys(packaged.dependencies), finishedAt: new Date().toISOString() });
    return installed;
  } catch (error) {
    const phase = controller.signal.aborted ? 'cancelled' : 'failed';
    state(phase, phase === 'cancelled' ? '安装已取消，缓存已保留' : '工具安装失败，可以重试', { state: phase, error: String(error.message || error).slice(-4000), finishedAt: new Date().toISOString() });
    throw error;
  } finally {
    journal.close();
    const owner = JSON.parse(fs.readFileSync(lock, 'utf8'));
    if (owner.token === token) await fsp.unlink(lock);
    // Keep source, npm dependencies and download caches for the next attempt.
    // Configuration files can contain secrets and are never retained.
    if (fs.existsSync(stage)) await removeWithin(root, path.join(stage, '.verification'));
  }
}
module.exports = { installTool, npmCli };
if (require.main === module) {
  const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  fs.unlinkSync(process.argv[2]);
  installTool(input).catch(error => { console.error(error.message); process.exitCode = 1; });
}

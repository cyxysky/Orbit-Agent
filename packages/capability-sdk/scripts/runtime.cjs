#!/usr/bin/env node
/* Runtime bootstrap runs directly from published scripts without depending on dist. */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { runtimeDirectory, readManagedRuntime } = require('../runtime/managed/layout.cjs');
const spec = require('../runtime/managed/spec.json');
const packageRoot = path.resolve(__dirname, '..');
const requirements = path.join(packageRoot, 'runtime', 'sensitive-data', 'python', 'requirements.txt');
const log = message => process.stderr.write(`[capability-sdk] ${message}\n`);

function platformPlan(platform = process.platform, arch = process.arch, osRelease) {
  const uv = spec.uv[`${platform}-${arch}`];
  if (!uv) throw new Error(`Automatic runtime installation does not support ${platform}/${arch}. Supported: Windows x64, Debian/Ubuntu Linux x64 and arm64.`);
  if (platform === 'linux') {
    const release = osRelease ?? fs.readFileSync('/etc/os-release', 'utf8');
    const fields = Object.fromEntries(release.split('\n').filter(line => line.includes('=')).map(line => {
      const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, '')];
    }));
    const versions = { ubuntu: ['22.04', '24.04'], debian: ['12', '13'] };
    if (!versions[fields.ID]?.includes(fields.VERSION_ID)) throw new Error(`Automatic Linux setup supports Ubuntu 22.04/24.04 and Debian 12/13; detected ${fields.ID} ${fields.VERSION_ID}.`);
  }
  return {
    platform, arch, uv,
    steps: [platform === 'win32' ? 'Copy LibreOffice/UNO into the project or extract the verified Windows MSI there' : 'Prepare OS libraries through apt; copy LibreOffice/PyUNO into the project and use a matching managed Python',
      'Install a managed Python 3.11 environment with uv',
      'Install CPU PyTorch and sensitive-data Python dependencies',
      'Download all three default sensitive-data models',
      'Install the matching Playwright Chromium and validate a headless launch',
      'Validate LibreOffice, PyUNO, FFmpeg and Python; then atomically record ready state'],
  };
}

function run(command, args, { env = process.env, cwd, capture = false, timeout = 30 * 60_000, accepted = [0] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, cwd, windowsHide: true, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '', timedOut = false;
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-2 * 1024 * 1024); if (!capture) process.stderr.write(chunk); });
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-32000); if (!capture) process.stderr.write(chunk); });
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid && process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.once('error', () => child.kill());
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      }
    }, timeout);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`${path.basename(command)} timed out after ${timeout}ms.`));
      else if (accepted.includes(code)) resolve(output.trim());
      else reject(new Error(`${path.basename(command)} exited with ${code}: ${errors || output}`));
    });
  });
}

async function works(command, args, options = {}) {
  if (!command) return false;
  try { await run(command, args, { capture: true, timeout: 30000, ...options }); return true; }
  catch { return false; }
}

async function download(url, checksum, destination) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await downloadOnce(url, checksum, destination); }
    catch (error) {
      if (attempt >= 3) throw error;
      log(`Download interrupted (${error.cause?.code || error.message}); resuming attempt ${attempt + 2}/4.`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
}

async function downloadOnce(url, checksum, destination) {
  const hashFile = async file => {
    const hash = createHash('sha256'); for await (const chunk of fs.createReadStream(file)) hash.update(chunk); return hash.digest('hex');
  };
  if (fs.existsSync(destination) && await hashFile(destination) === checksum) return;
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.part`;
  if (fs.existsSync(temporary) && await hashFile(temporary) === checksum) {
    await fsp.rm(destination, { force: true }); await fsp.rename(temporary, destination); return;
  }
  const { fetch: downloadFetch, EnvHttpProxyAgent } = require('undici');
  const dispatcher = new EnvHttpProxyAgent({ headersTimeout: 30000, bodyTimeout: 60000 });
  try {
    log(`Downloading ${path.basename(destination)}`);
    let offset = fs.existsSync(temporary) ? fs.statSync(temporary).size : 0;
    let currentUrl = url;
    while (true) {
      const response = await downloadFetch(currentUrl, { dispatcher, headers: { Range: `bytes=${offset}-${offset + 4 * 1024 * 1024 - 1}` }, signal: AbortSignal.timeout(120000) });
      if (!response.ok || !response.body || !response.url.startsWith('https://')) throw new Error(`Download failed: ${response.status} ${url}`);
      currentUrl = response.url;
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
      if (response.status === 206 && (!range || Number(range[1]) !== offset)) throw new Error('Download server returned an unexpected byte range.');
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary, { flags: response.status === 206 ? 'a' : 'w' }));
      const length = fs.statSync(temporary).size;
      if (response.status !== 206) break;
      if (length <= offset || length !== Number(range[2]) + 1) throw new Error('Download ended before the requested range completed; retry installation to resume.');
      offset = length;
      log(`${path.basename(destination)}: ${Math.round(length / 1024 / 1024)} / ${Math.round(Number(range[3]) / 1024 / 1024)} MiB`);
      if (length === Number(range[3])) break;
    }
    if (await hashFile(temporary) !== checksum) { await fsp.unlink(temporary); throw new Error(`SHA-256 mismatch: ${url}`); }
    await fsp.rm(destination, { force: true });
    await fsp.rename(temporary, destination);
  } finally { await dispatcher.destroy(); }
}

function findFile(directory, name, depth = 3) {
  if (depth < 0 || !fs.existsSync(directory)) return undefined;
  const direct = path.join(directory, name);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === name) return filename;
    if (entry.isDirectory()) { const found = findFile(filename, name, depth - 1); if (found) return found; }
  }
}

function unoEnvironment(executable, python) {
  const directory = path.dirname(executable);
  return { ...process.env, PATH: [directory, process.env.PATH].filter(Boolean).join(path.delimiter), PYTHONPATH: [directory, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    ...(process.platform === 'linux' ? { LD_LIBRARY_PATH: [directory, python ? path.resolve(path.dirname(python), '../lib') : '', process.env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter) } : {}) };
}

async function officeCandidates(cache, system = false) {
  const programs = process.platform === 'win32'
    ? (system ? [process.env.LIBREOFFICE_PATH, path.join(process.env.ProgramFiles || 'C:\\Program Files', 'LibreOffice', 'program', 'soffice.exe')]
      : [path.join(cache, 'libreoffice', 'program', 'soffice.exe')])
    : (system ? [process.env.LIBREOFFICE_PATH, '/usr/lib/libreoffice/program/soffice'] : [path.join(cache, 'libreoffice', 'program', 'soffice')]);
  for (const candidate of programs.filter(Boolean)) {
    // The Windows GUI launcher can keep pipes open even for --version; use its console entry.
    const consoleEntry = candidate.replace(/\.exe$/i, '.com');
    const entry = process.platform === 'win32' && fs.existsSync(consoleEntry) ? consoleEntry : candidate;
    const executable = await fsp.realpath(entry).catch(() => entry);
    if (!await works(executable, ['--headless', '--version'])) continue;
    const pythonCandidates = system ? [process.env.LIBREOFFICE_PYTHON_PATH, process.platform === 'win32' ? findFile(path.dirname(executable), 'python.exe') : '/usr/bin/python3']
      : [process.platform === 'win32' ? findFile(path.dirname(executable), 'python.exe') : await fsp.readFile(path.join(cache, 'uno-python.txt'), 'utf8').catch(() => '')];
    for (const python of pythonCandidates.filter(Boolean)) {
      if (await works(python, ['-c', 'import uno'], { env: unoEnvironment(executable, python), cwd: path.dirname(executable) })) return { libreoffice: executable, unoPython: python };
    }
  }
}

async function installOffice(cache) {
  const local = await officeCandidates(cache);
  if (local) return local;
  if (process.platform === 'linux') {
    const packagesPresent = await works('dpkg-query', ['-W', '-f=${db:Status-Status}\n', ...spec.linuxPackages]);
    const statuses = packagesPresent ? await run('dpkg-query', ['-W', '-f=${db:Status-Status}\n', ...spec.linuxPackages], { capture: true }) : '';
    if (!packagesPresent || statuses.split('\n').some(status => status !== 'installed')) {
      await privileged('apt-get', ['update']);
      await privileged('apt-get', ['install', '-y', '--no-install-recommends', ...spec.linuxPackages]);
    }
  }
  const system = await officeCandidates(cache, true);
  if (system) {
    const source = path.resolve(path.dirname(system.libreoffice), '..');
    const target = path.join(cache, 'libreoffice');
    if (path.basename(path.dirname(system.libreoffice)) !== 'program' || !fs.existsSync(path.join(source, 'program', process.platform === 'win32' ? 'soffice.exe' : 'soffice'))) throw new Error('Cannot identify a LibreOffice installation directory to copy.');
    if (source === target) throw new Error('LibreOffice source and project destination must differ.');
    log('Copying LibreOffice and UNO into the project runtime.');
    await fsp.cp(source, target, { recursive: true, dereference: true });
    if (process.platform === 'linux') {
      const version = await run(system.unoPython, ['-c', 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'], { capture: true });
      const uv = findFile(path.join(cache, `uv-${spec.uvVersion}`), 'uv');
      await run(uv, ['python', 'install', version], { env: pythonEnvironment(cache) });
      const python = await run(uv, ['python', 'find', '--managed-python', version], { env: pythonEnvironment(cache), capture: true });
      for (const module of ['uno', 'unohelper', 'pyuno']) {
        const filename = await run(system.unoPython, ['-c', `import ${module}; print(${module}.__file__)`], { env: unoEnvironment(system.libreoffice, system.unoPython), capture: true });
        await fsp.copyFile(filename, path.join(target, 'program', path.basename(filename)));
      }
      await fsp.writeFile(path.join(cache, 'uno-python.txt'), python);
    }
    const copied = await officeCandidates(cache);
    if (!copied) throw new Error('Project-local LibreOffice/PyUNO validation failed after copying.');
    return copied;
  }
  if (process.platform === 'linux') throw new Error('LibreOffice or PyUNO is unavailable after apt installation.');
  const msi = path.join(cache, 'downloads', `LibreOffice-${spec.libreoffice.version}.msi`);
  await download(spec.libreoffice.url, spec.libreoffice.sha256, msi);
  await run('msiexec.exe', ['/a', msi, '/qn', `TARGETDIR=${path.join(cache, 'libreoffice')}`, '/norestart'], { accepted: [0, 3010] });
  const result = await officeCandidates(cache);
  if (!result) throw new Error('LibreOffice MSI extraction did not produce a working LibreOffice/PyUNO runtime. Check Windows Installer permissions.');
  return result;
}

async function privileged(command, args) {
  const env = { ...process.env, DEBIAN_FRONTEND: 'noninteractive' };
  if (process.getuid?.() === 0) return run(command, args, { env });
  if (!await works('sudo', ['-n', 'true'])) throw new Error('Linux system libraries are missing. Run installation with root or passwordless sudo; npm cannot grant system permissions. Retry with capability-runtime install after preparing permissions.');
  return run('sudo', ['-n', 'env', 'DEBIAN_FRONTEND=noninteractive', command, ...args]);
}

function pythonEnvironment(cache) {
  return { ...process.env, UV_PYTHON_INSTALL_DIR: path.join(cache, 'python'), UV_PYTHON_BIN_DIR: path.join(cache, 'python-bin'), UV_CACHE_DIR: path.join(cache, 'uv-cache'), UV_NO_PROGRESS: '1' };
}

async function installPython(cache, plan) {
  const directory = path.join(cache, `uv-${spec.uvVersion}`);
  let uv = findFile(directory, process.platform === 'win32' ? 'uv.exe' : 'uv');
  if (!uv) {
    const archive = path.join(cache, 'downloads', plan.uv.file);
    await download(`https://github.com/astral-sh/uv/releases/download/${spec.uvVersion}/${plan.uv.file}`, plan.uv.sha256, archive);
    await fsp.mkdir(directory, { recursive: true });
    if (process.platform === 'win32') {
      // Paths are data in environment variables; no shell interpolation of caller-controlled strings.
      await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', "Expand-Archive -LiteralPath $env:CAPABILITY_ARCHIVE -DestinationPath $env:CAPABILITY_EXTRACT -Force"], { env: { ...process.env, CAPABILITY_ARCHIVE: archive, CAPABILITY_EXTRACT: directory } });
    } else await run('tar', ['-xzf', archive, '-C', directory]);
    uv = findFile(directory, process.platform === 'win32' ? 'uv.exe' : 'uv');
  }
  if (!uv) throw new Error('The verified uv archive did not contain the expected executable.');
  const env = pythonEnvironment(cache);
  await run(uv, ['python', 'install', spec.pythonVersion], { env });
  const venv = path.join(cache, 'venv');
  const python = path.join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!fs.existsSync(python)) await run(uv, ['venv', '--seed', '--managed-python', '--python', spec.pythonVersion, venv], { env });
  await run(uv, ['pip', 'install', '--python', python, '--index-url', 'https://download.pytorch.org/whl/cpu', 'torch>=2.2,<3'], { env });
  await run(uv, ['pip', 'install', '--python', python, '-r', requirements], { env });
  return python;
}

async function installModels(cache, python) {
  const models = {};
  for (const [key, repository] of Object.entries(spec.models)) {
    models[key] = path.join(cache, 'models', key);
    log(`Preparing model ${repository}`);
    await run(python, ['-c', 'from huggingface_hub import snapshot_download; import sys; snapshot_download(repo_id=sys.argv[1], local_dir=sys.argv[2], allow_patterns=["*.json", "*.txt", "*.py", "*.model", "*.safetensors", "pytorch_model*.bin", "LICENSE*", "README.md"])', repository, models[key]], {
      timeout: 2 * 60 * 60_000, env: { ...process.env, HF_HOME: path.join(cache, 'huggingface'), HF_HUB_CACHE: process.env.HF_HUB_CACHE || path.join(cache, 'huggingface', 'hub'), HF_XET_CACHE: path.join(cache, 'huggingface', 'xet') },
    });
  }
  return models;
}

function fingerprint() {
  return createHash('sha256').update(JSON.stringify(spec)).update(fs.readFileSync(requirements)).update(require('playwright/package.json').version).update(require('ffmpeg-static/package.json').version).digest('hex');
}

async function verify(runtime, { loadModels = false } = {}) {
  const failures = [];
  for (const [name, executable, args, options] of [
    ['Python dependencies', runtime?.python, ['-c', 'import torch, gliner2, transformers, uvicorn, fastapi; from huggingface_hub import snapshot_download'], { timeout: 120000 }],
    ['LibreOffice', runtime?.libreoffice, ['--headless', '--version']],
    ['PyUNO', runtime?.unoPython, ['-c', 'import uno'], runtime?.libreoffice ? { env: unoEnvironment(runtime.libreoffice, runtime.unoPython), cwd: path.dirname(runtime.libreoffice) } : {}],
    ['FFmpeg', runtime?.ffmpeg, ['-version']],
  ]) if (!await works(executable, args, options)) failures.push(name);
  for (const key of Object.keys(spec.models)) {
    const directory = runtime?.models?.[key];
    if (!directory || !fs.existsSync(path.join(directory, 'config.json')) || !fs.readdirSync(directory).some(name => /\.(safetensors|bin)$/.test(name))) failures.push(`model ${key}`);
  }
  if (loadModels && !failures.some(name => name.startsWith('model ') || name === 'Python dependencies')) {
    try {
      const huggingFaceHome = path.join(runtimeDirectory(), 'huggingface');
      await run(runtime.python, ['-c', 'import app; assert app.health()["status"] == "ok"; print("All sensitive-data models loaded offline")'], {
        capture: true, timeout: 10 * 60_000, cwd: path.join(packageRoot, 'runtime', 'sensitive-data', 'python'),
        env: { ...process.env, GLINER_MODEL: runtime.models.gliner, GLINER_CHINESE_NER_MODEL: runtime.models.chinese, GLINER_PII_MODEL: runtime.models.pii, GLINER_DEVICE: 'cpu', HF_HOME: huggingFaceHome, HF_HUB_CACHE: path.join(huggingFaceHome, 'hub'), HF_MODULES_CACHE: path.join(huggingFaceHome, 'modules'), TRANSFORMERS_CACHE: path.join(huggingFaceHome, 'hub'), HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', PYTHONDONTWRITEBYTECODE: '1' },
      });
    } catch (error) { failures.push(`Sensitive-data model loading: ${error.message.slice(-3000)}`); }
  }
  try {
    if (!runtime?.chromium || !fs.existsSync(runtime.chromium)) throw new Error('Chromium is missing');
    const browser = await require('playwright').chromium.launch({ executablePath: runtime.chromium, headless: true, timeout: 30000 });
    try { const page = await browser.newPage(); await page.setContent('<p>runtime ready</p>'); if (await page.textContent('p') !== 'runtime ready') throw new Error('Render failed'); }
    finally { await browser.close(); }
  } catch (error) { failures.push(`Chromium: ${error.message}`); }
  return failures;
}

async function acquireLock(directory) {
  const deadline = Date.now() + 2 * 60 * 60_000;
  while (true) {
    try { await fsp.mkdir(directory); await fsp.writeFile(path.join(directory, 'owner.json'), JSON.stringify({ pid: process.pid, host: os.hostname() })); return; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const owner = JSON.parse(await fsp.readFile(path.join(directory, 'owner.json'), 'utf8'));
        if (owner.host === os.hostname()) {
          try { process.kill(owner.pid, 0); }
          catch (probe) { if (probe.code === 'ESRCH') { await fsp.unlink(path.join(directory, 'owner.json')); await fsp.rmdir(directory); continue; } }
        }
      } catch { /* The other installer may still be writing its lock. */ }
      if (Date.now() > deadline) throw new Error(`Another installer holds ${directory}; inspect owner.json before removing an abandoned lock.`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

async function install() {
  const plan = platformPlan();
  const cache = runtimeDirectory();
  await fsp.mkdir(cache, { recursive: true });
  const lock = path.join(cache, '.install-lock');
  await acquireLock(lock);
  try {
    const existing = readManagedRuntime();
    if (existing?.fingerprint === fingerprint() && !(await verify(existing)).length) { log('All runtimes are already ready.'); return existing; }
    // An interrupted repair must not leave a stale ready marker.
    await fsp.rm(path.join(cache, 'runtime.json'), { force: true });
    const python = await installPython(cache, plan);
    const office = await installOffice(cache);
    const models = await installModels(cache, python);
    const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
    if (process.platform === 'linux' && !await works(process.execPath, [cli, 'install-deps', '--dry-run', 'chromium'])) await privileged(process.execPath, [cli, 'install-deps', 'chromium']);
    const browserEnvironment = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(cache, 'browsers') };
    await run(process.execPath, [cli, 'install', 'chromium'], { env: browserEnvironment });
    const chromium = await run(process.execPath, ['-e', "console.log(require('playwright').chromium.executablePath())"], { cwd: packageRoot, env: browserEnvironment, capture: true });
    const ffmpegSource = require('ffmpeg-static');
    if (!ffmpegSource || !fs.existsSync(ffmpegSource)) throw new Error('ffmpeg-static did not install its executable. Check whether npm dependency scripts were disabled.');
    const ffmpeg = path.join(cache, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    await fsp.mkdir(path.dirname(ffmpeg), { recursive: true });
    await fsp.copyFile(ffmpegSource, ffmpeg);
    if (process.platform !== 'win32') await fsp.chmod(ffmpeg, 0o755);
    const runtime = { format: 2, status: 'ready', platform: process.platform, arch: process.arch, fingerprint: fingerprint(), python, ...office, models, chromium, ffmpeg };
    for (const executable of [python, office.libreoffice, office.unoPython, chromium, ffmpeg]) {
      const relative = path.relative(cache, executable);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Runtime executable is outside the project runtime: ${executable}`);
    }
    const failures = await verify(runtime, { loadModels: true });
    if (failures.length) throw new Error(`Runtime validation failed: ${failures.join('; ')}`);
    const temporary = path.join(cache, `runtime-${process.pid}.json`);
    await fsp.writeFile(temporary, JSON.stringify(runtime, null, 2) + '\n');
    await fsp.rename(temporary, path.join(cache, 'runtime.json'));
    log(`All runtimes ready: ${cache}`);
    return runtime;
  } finally { await fsp.unlink(path.join(lock, 'owner.json')); await fsp.rmdir(lock); }
}

async function main(args = process.argv.slice(2)) {
  if (process.env.npm_lifecycle_event === 'postinstall') {
    const project = process.env.npm_config_local_prefix || process.env.INIT_CWD;
    if (!project) throw new Error('Cannot locate the consuming npm project. Run capability-runtime install from its root directory.');
    process.chdir(project);
  }
  const command = args[0] || 'install';
  if (command === 'plan') { process.stdout.write(JSON.stringify({ ...platformPlan(), directory: runtimeDirectory() }, null, 2) + '\n'); return; }
  if (command === 'doctor') {
    const runtime = readManagedRuntime();
    const failures = await verify(runtime, { loadModels: true });
    if (!runtime) failures.unshift('No completed runtime installation');
    else if (runtime.fingerprint !== fingerprint()) failures.push('Runtime dependencies changed; run capability-runtime install');
    process.stdout.write(JSON.stringify({ ready: failures.length === 0, directory: runtimeDirectory(), failures }, null, 2) + '\n');
    if (failures.length) process.exitCode = 1;
    return;
  }
  if (command !== 'install') throw new Error('Usage: capability-runtime [install|doctor|plan]');
  if (process.env.CAPABILITY_SKIP_RUNTIME_INSTALL === '1') { log('Runtime installation explicitly skipped; execution environments are NOT prepared. Run capability-runtime install later.'); return; }
  await install();
}

module.exports = { platformPlan, verify, install, main };
if (require.main === module) main().catch(error => { log(error.message); process.exitCode = 1; });

const path = require('node:path');
const { spawn } = require('node:child_process');
const { mkdtemp, mkdir, rm, writeFile, chmod } = require('node:fs/promises');
const { collectFiles, stageFiles } = require('./files.cjs');

// One process implementation for the SDK and HTTP runner. Transport and authentication belong to hosts.
function createCodeExecutionEngine(options) {
  const WORKSPACE_ROOT = path.resolve(options.workspaceDirectory);
  const NODE_EXECUTABLE = options.nodeExecutable || process.execPath;
  const PIP_CACHE_DIRECTORY = options.pipCacheDirectory || '';
  const lifetime = new AbortController();
  const jobs = new Set();
  const MAX_CODE_CHARS = 100_000;
  const MAX_OUTPUT_CHARS = 200_000;
  const MAX_PACKAGES = 32;
  const MAX_TIMEOUT_MS = 300_000;
  const MAX_INSTALL_TIMEOUT_MS = 600_000;
  const MAX_CONCURRENCY = Math.max(1, Math.min(16, Math.floor(Number(options.maxConcurrent) || 2)));
  const PYTHON_EXECUTABLE = options.pythonExecutable || (process.platform === 'win32' ? 'python' : 'python3');
  const NPM_CLI = options.npmCli;
  const PYTHON_BIN_DIRECTORY = process.platform === 'win32' ? 'Scripts' : 'bin';
  const PYTHON_BINARY = process.platform === 'win32' ? 'python.exe' : 'python';
  const children = new Set();
  async function allowJobDirectoryAccess(directory) {
    // The container drops CHOWN; its unprivileged job UID still needs to write here.
    if (options.dropPrivileges === true && process.platform === 'linux' && process.getuid?.() === 0) await chmod(directory, 0o777);
  }
  const npmPackageSpec = /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
  const pythonPackageSpec = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\[[A-Za-z0-9_,.-]+\])?==\d+(?:\.\d+)+(?:[A-Za-z0-9.+-]*)$/;

  let active = 0;
  const waiters = [];

  function acquire(signal) {
    if (signal?.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('Operation aborted.'));
    if (active < MAX_CONCURRENCY) {
      active += 1;
      return Promise.resolve(() => release());
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal, onAbort: undefined };
      waiter.onAbort = () => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(signal?.reason instanceof Error ? signal.reason : new Error('Operation aborted.'));
      };
      signal?.addEventListener('abort', waiter.onAbort, { once: true });
      waiters.push(waiter);
    });
  }

  function release() {
    active = Math.max(0, active - 1);
    while (waiters.length) {
      const waiter = waiters.shift();
      if (waiter.onAbort) waiter.signal?.removeEventListener('abort', waiter.onAbort);
      if (waiter.signal?.aborted) { waiter.reject(waiter.signal.reason || new Error('Operation aborted.')); continue; }
      active += 1;
      waiter.resolve(() => release());
      break;
    }
  }

  function terminateProcessTree(child) {
    if (!child.pid) return;
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
        .once('error', () => { try { child.kill('SIGKILL'); } catch { /* Already exited. */ } });
      return;
    }
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* process group may already be gone */ }
    try { child.kill('SIGKILL'); } catch { /* process may already be gone */ }
  }

  function runBoundedProcess(input) {
    if (input.signal?.aborted) return Promise.reject(input.signal.reason instanceof Error ? input.signal.reason : new Error('Operation aborted.'));
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(input.executable, input.args, {
          cwd: input.cwd,
          env: input.env,
          shell: input.shell || false,
          stdio: 'pipe',
          detached: true,
          windowsHide: true,
          ...(options.dropPrivileges === true && process.platform === 'linux' && process.getuid?.() === 0 ? { uid: 10001, gid: 10001 } : {}),
        });
      } catch (error) {
        resolve({ exitCode: null, stdout: '', stderr: '', truncated: false, timedOut: false, aborted: false, outputLimitExceeded: false, error: error.message || String(error) });
        return;
      }
      children.add(child);
      child.stdin.end();
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      let stdout = '';
      let stderr = '';
      let outputLength = 0;
      let outputLimitExceeded = false;
      let stopReason;
      let spawnError;
      let timer;
      const stop = (reason) => {
        if (stopReason) return;
        stopReason = reason;
        terminateProcessTree(child);
      };
      const onAbort = () => stop('abort');
      input.signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => stop('timeout'), input.timeoutMs);
      const append = (target, chunk) => {
        const text = String(chunk);
        const remaining = Math.max(0, input.maxOutputChars - outputLength);
        const bounded = text.slice(0, remaining);
        outputLength += bounded.length;
        if (target === 'stdout') stdout += bounded;
        else stderr += bounded;
        if (bounded.length < text.length) outputLimitExceeded = true;
      };
      child.stdout.on('data', (chunk) => append('stdout', chunk));
      child.stderr.on('data', (chunk) => append('stderr', chunk));
      child.once('error', (error) => { spawnError = error.message || String(error); });
      child.once('close', (exitCode, signal) => {
        children.delete(child);
        clearTimeout(timer);
        input.signal?.removeEventListener('abort', onAbort);
        resolve({
          exitCode,
          signal: signal || undefined,
          stdout,
          stderr,
          truncated: outputLimitExceeded,
          timedOut: stopReason === 'timeout',
          aborted: stopReason === 'abort',
          outputLimitExceeded,
          error: spawnError,
        });
      });
    });
  }

  function environment(jobDirectory, pythonPackages) {
    return {
      NODE_ENV: 'production',
      PATH: process.env.PATH,
      HOME: path.join(jobDirectory, 'home'),
      TMPDIR: path.join(jobDirectory, 'tmp'),
      TEMP: path.join(jobDirectory, 'tmp'),
      TMP: path.join(jobDirectory, 'tmp'),
      ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
        COMSPEC: process.env.COMSPEC, PATHEXT: process.env.PATHEXT, USERPROFILE: process.env.USERPROFILE,
        APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA } : {}),
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      PYTHONNOUSERSITE: '1',
      // Job environments are deleted immediately; bytecode cannot be reused.
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONPATH: pythonPackages,
      ...(PIP_CACHE_DIRECTORY ? { PIP_CACHE_DIR: PIP_CACHE_DIRECTORY } : {}),
      NPM_CONFIG_AUDIT: 'false',
      NPM_CONFIG_FUND: 'false',
    };
  }

  function failureText(result) {
    return [result.error, result.stderr && result.stderr.trim(), result.stdout && result.stdout.trim()].filter(Boolean).join('\n').slice(0, 8_000) || 'Process failed.';
  }

  function installationError(stage, result, timeoutMs) {
    const noWheel = stage === 'Package installation'
      && /No matching distribution found|Could not find a version that satisfies the requirement/i.test(`${result.stderr}\n${result.stdout}`);
    const reason = result.timedOut
      ? `${stage} timed out after ${timeoutMs}ms.`
      : result.aborted ? `${stage} was aborted.`
        : noWheel ? 'Package installation failed: no compatible binary wheel was found for this Python version and platform.'
          : `${stage} failed.`;
    return new Error(`${reason}\n${failureText(result)}`);
  }

  async function installPackages(input) {
    if (!input.packages.length) return { elapsedMs: 0 };
    const target = input.language === 'javascript' ? input.jobDirectory : path.join(input.jobDirectory, 'python-packages');
    await mkdir(target, { recursive: true });
    await allowJobDirectoryAccess(target);
    const startedAt = Date.now();
    if (input.language === 'javascript') {
      const result = await runBoundedProcess({
        executable: NPM_CLI ? NODE_EXECUTABLE : options.npmExecutable || (process.platform === 'win32' ? 'npm.cmd' : 'npm'),
        args: [...(NPM_CLI ? [NPM_CLI] : []), 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--no-save', '--prefix', input.jobDirectory, ...input.packages],
        cwd: input.jobDirectory,
        env: input.env,
        timeoutMs: input.timeoutMs,
        maxOutputChars: 8_000,
        signal: input.signal,
        shell: !NPM_CLI && process.platform === 'win32',
      });
      if (result.error || result.exitCode !== 0) throw installationError('Package installation', result, input.timeoutMs);
    } else {
      const venv = path.join(input.jobDirectory, '.venv');
      const venvResult = await runBoundedProcess({
        executable: PYTHON_EXECUTABLE,
        args: ['-m', 'venv', venv],
        cwd: input.jobDirectory,
        env: input.env,
        timeoutMs: input.timeoutMs,
        maxOutputChars: 8_000,
        signal: input.signal,
      });
      if (venvResult.error || venvResult.exitCode !== 0) throw installationError('Python environment creation', venvResult, input.timeoutMs);
      const pip = path.join(venv, PYTHON_BIN_DIRECTORY, process.platform === 'win32' ? 'pip.exe' : 'pip');
      const result = await runBoundedProcess({
        executable: pip,
        args: ['install', '--disable-pip-version-check', '--no-input', '--no-compile', ...(PIP_CACHE_DIRECTORY ? [] : ['--no-cache-dir']), '--only-binary=:all:', '--target', target, ...input.packages],
        cwd: input.jobDirectory,
        env: input.env,
        timeoutMs: Math.max(1, input.timeoutMs - (Date.now() - startedAt)),
        maxOutputChars: 8_000,
        signal: input.signal,
      });
      if (result.error || result.exitCode !== 0) throw installationError('Package installation', result, input.timeoutMs);
      input.executable = path.join(venv, PYTHON_BIN_DIRECTORY, PYTHON_BINARY);
    }
    return { elapsedMs: Date.now() - startedAt };
  }

  async function execute(payload, signal) {
    if (!payload || typeof payload !== 'object') throw new Error('Execution payload must be an object.');
    const language = payload.language;
    if (language !== 'javascript' && language !== 'python') throw new Error('Unsupported language.');
    if (typeof payload.code !== 'string' || payload.code.length < 1 || payload.code.length > MAX_CODE_CHARS) throw new Error('Code length is outside the allowed range.');
    const args = Array.isArray(payload.args) ? payload.args : [];
    const packages = Array.isArray(payload.packages) ? payload.packages.map((item) => String(item).trim()) : [];
    if (args.length > 32 || args.some((item) => typeof item !== 'string' || item.length > 2_000)) throw new Error('Invalid execution arguments.');
    if (packages.length > MAX_PACKAGES) throw new Error(`At most ${MAX_PACKAGES} packages may be installed per execution.`);
    const packagePattern = language === 'javascript' ? npmPackageSpec : pythonPackageSpec;
    const invalidPackages = packages.filter((item) => !packagePattern.test(item));
    if (invalidPackages.length) throw new Error(`Only exact package versions are allowed: ${invalidPackages.join(', ')}`);
    if (payload.networkMode !== 'full') throw new Error('This runner is network-enabled. Use a separately deployed no-network runner for networkMode=none.');

    const timeoutMs = Math.max(1_000, Math.min(MAX_TIMEOUT_MS, Number(payload.timeoutMs) || 300_000));
    const installTimeoutMs = Math.max(5_000, Math.min(MAX_INSTALL_TIMEOUT_MS, Number(payload.installTimeoutMs) || MAX_INSTALL_TIMEOUT_MS));
    const maxOutputChars = Math.max(1_000, Math.min(MAX_OUTPUT_CHARS, Number(payload.maxOutputChars) || 30_000));
    const startedAt = Date.now();
    let jobDirectory;
    try {
      await mkdir(WORKSPACE_ROOT, { recursive: true });
      jobDirectory = await mkdtemp(path.join(WORKSPACE_ROOT, 'job-'));
      await chmod(jobDirectory, options.dropPrivileges ? 0o777 : 0o700).catch(() => undefined);
      await stageFiles(jobDirectory, payload.inputFiles);
      await allowJobDirectoryAccess(path.join(jobDirectory, 'outputs')).catch(() => undefined);
      await mkdir(path.join(jobDirectory, 'home'), { recursive: true });
      await mkdir(path.join(jobDirectory, 'tmp'), { recursive: true, mode: 0o777 });
      await allowJobDirectoryAccess(path.join(jobDirectory, 'home'));
      await allowJobDirectoryAccess(path.join(jobDirectory, 'tmp'));
      const file = path.join(jobDirectory, `run-${Date.now()}.${language === 'python' ? 'py' : 'mjs'}`);
      await writeFile(file, payload.code, 'utf8');
      const pythonPackages = path.join(jobDirectory, 'python-packages');
      const env = environment(jobDirectory, pythonPackages);
      const execution = {
        language,
        packages,
        jobDirectory,
        executable: language === 'python' ? PYTHON_EXECUTABLE : NODE_EXECUTABLE,
        env,
        signal,
      };
      const install = await installPackages(Object.assign(execution, { timeoutMs: installTimeoutMs }));
      const result = await runBoundedProcess({
        executable: execution.executable,
        args: [file, ...args],
        cwd: jobDirectory,
        env,
        timeoutMs,
        maxOutputChars,
        signal,
      });
      if (result.error) throw new Error(result.error);
      return {
        exitCode: result.exitCode,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
        truncated: result.truncated,
        elapsedMs: Date.now() - startedAt,
        timedOut: result.timedOut,
        aborted: result.aborted,
        outputLimitExceeded: result.outputLimitExceeded,
        packagesInstalled: packages.length ? packages : undefined,
        installElapsedMs: install.elapsedMs || undefined,
        files: !result.aborted && !result.timedOut ? await collectFiles(jobDirectory, payload.outputFiles) : [],
      };
    } finally {
      if (jobDirectory) await rm(jobDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(() => undefined);
    }
  }


  return {
    run(payload, signal) {
      if (lifetime.signal.aborted) return Promise.reject(new Error('Code execution engine is closed.'));
      const combined = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
      const job = (async () => {
        const releaseSlot = await acquire(combined);
        try { return await execute(payload, combined); } finally { releaseSlot(); }
      })();
      jobs.add(job);
      void job.then(() => jobs.delete(job), () => jobs.delete(job));
      return job;
    },
    async health() {
      if (lifetime.signal.aborted) return {status:'unhealthy', message:'Code execution engine is closed.'};
      try {
        await mkdir(WORKSPACE_ROOT, {recursive:true});
        const results = await Promise.all([NODE_EXECUTABLE, PYTHON_EXECUTABLE].map(executable => runBoundedProcess({
          executable, args:['--version'], cwd:WORKSPACE_ROOT, env:{...process.env, ...(process.versions.electron ? {ELECTRON_RUN_AS_NODE:'1'} : {})},
          timeoutMs:5000, maxOutputChars:1000, signal:lifetime.signal,
        })));
        const failures = results.flatMap((result,index) => result.error || result.exitCode !== 0 ? [(index ? 'Python: ' : 'Node: ') + failureText(result)] : []);
        return failures.length ? {status:'needs-runtime',message:failures.join(' ')} : {status:'healthy'};
      } catch(error) { return {status:'unhealthy',message:error.message || String(error)}; }
    },
    async dispose() {
      lifetime.abort(new Error('Code execution engine closed.'));
      for (const child of children) terminateProcessTree(child);
      await Promise.allSettled([...jobs]);
      // Only per-job directories are removed by execute(); the caller owns the workspace and its other files.
    },
  };
}
module.exports = {createCodeExecutionEngine};

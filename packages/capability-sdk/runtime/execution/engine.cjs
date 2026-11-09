const path = require('node:path');
const { spawn } = require('node:child_process');
const { mkdtemp, mkdir, rm, writeFile, chmod, chown, lstat } = require('node:fs/promises');
const { collectFiles, stageFiles } = require('./files.cjs');
const { acquireJobIdentity, prepareJobIdentity, validateIsolation } = require('./isolation.cjs');
const { landlockProbe, landlockCommand } = require('./landlock.cjs');
const { execFileSync } = require('node:child_process');

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
  const pythonExecutable = () => (typeof options.pythonExecutable === 'function' ? options.pythonExecutable() : options.pythonExecutable) || (process.platform === 'win32' ? 'python' : 'python3');
  const NPM_CLI = options.npmCli;
  const PYTHON_BIN_DIRECTORY = process.platform === 'win32' ? 'Scripts' : 'bin';
  const PYTHON_BINARY = process.platform === 'win32' ? 'python.exe' : 'python';
  const children = new Set();
  const isolated = options.dropPrivileges === true && process.platform === 'linux';
  function requireIsolationPlatform() {
    if (options.dropPrivileges === true && !isolated) throw new Error('The isolated code runner requires Linux. Use Docker or a remote Linux runner on this platform.');
  }
  async function allowJobDirectoryAccess(directory, identity) {
    if (identity) await chown(directory, identity.uid, identity.gid);
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
        const command = input.identity ? landlockCommand(input, pythonExecutable(), NODE_EXECUTABLE, NPM_CLI, options.runtimeReadOnlyPaths) : input;
        child = spawn(command.executable, command.args, {
          cwd: input.cwd,
          env: input.env,
          shell: input.shell || false,
          stdio: 'pipe',
          // Unix needs a process group for tree termination. On Windows,
          // detached creates a separate console even with windowsHide enabled;
          // taskkill /T already handles the child tree without a detached group.
          detached: process.platform !== 'win32',
          windowsHide: true,
          ...(input.identity ? { uid: input.identity.uid, gid: input.identity.gid } : {}),
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
      let draining;
      const drainIdentity = () => draining ||= input.identity?.drain().catch(error => {
        spawnError = error.message || String(error);
        child.stdout.destroy(); child.stderr.destroy();
      });
      const stop = (reason) => {
        if (stopReason) return;
        stopReason = reason;
        terminateProcessTree(child);
        drainIdentity();
      };
      const onAbort = () => stop('abort');
      input.signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => stop('timeout'), input.timeoutMs);
      const append = (target, chunk) => {
        const text = String(chunk);
        const remaining = Math.max(0, input.maxOutputChars - outputLength);
        let end = Math.min(text.length, remaining);
        // The budget uses UTF-16 code units. Never retain half of an astral
        // character when truncating a decoded stdout/stderr chunk.
        if (end > 0 && end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff
          && text.charCodeAt(end) >= 0xdc00 && text.charCodeAt(end) <= 0xdfff) end--;
        const bounded = text.slice(0, end);
        outputLength += bounded.length;
        if (target === 'stdout') stdout += bounded;
        else stderr += bounded;
        if (bounded.length < text.length) {
          outputLimitExceeded = true;
          // Once the prefix is truncated, later chunks must not fill the unused
          // surrogate slot with unrelated text.
          outputLength = input.maxOutputChars;
        }
      };
      child.stdout.on('data', (chunk) => append('stdout', chunk));
      child.stderr.on('data', (chunk) => append('stderr', chunk));
      child.once('error', (error) => { spawnError = error.message || String(error); });
      child.once('exit', drainIdentity);
      child.once('close', async (exitCode, signal) => {
        children.delete(child);
        clearTimeout(timer);
        input.signal?.removeEventListener('abort', onAbort);
        await drainIdentity();
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
      // Pipes are decoded as UTF-8; Python must not use the host ANSI code page.
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUNBUFFERED: '1',
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
    await allowJobDirectoryAccess(target, input.identity);
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
        identity: input.identity,
        shell: !NPM_CLI && process.platform === 'win32',
      });
      if (result.error || result.exitCode !== 0) throw installationError('Package installation', result, input.timeoutMs);
    } else {
      const venv = path.join(input.jobDirectory, '.venv');
      const venvResult = await runBoundedProcess({
        executable: pythonExecutable(),
        args: ['-m', 'venv', venv],
        cwd: input.jobDirectory,
        env: input.env,
        timeoutMs: input.timeoutMs,
        maxOutputChars: 8_000,
        signal: input.signal,
        identity: input.identity,
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
        identity: input.identity,
      });
      if (result.error || result.exitCode !== 0) throw installationError('Package installation', result, input.timeoutMs);
      input.executable = path.join(venv, PYTHON_BIN_DIRECTORY, PYTHON_BINARY);
    }
    return { elapsedMs: Date.now() - startedAt };
  }

  async function execute(payload, signal) {
    requireIsolationPlatform();
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
    let jobDirectory, identity;
    try {
      if (isolated) identity = await acquireJobIdentity(signal);
      if (identity) signal = AbortSignal.any([signal, identity.signal]);
      await mkdir(WORKSPACE_ROOT, { recursive: true });
      if (isolated) {
        const rootInfo = await lstat(WORKSPACE_ROOT);
        if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || rootInfo.uid !== 0) throw new Error('Sandbox workspace must be a root-owned directory.');
        await chmod(WORKSPACE_ROOT, 0o711);
      }
      jobDirectory = await mkdtemp(path.join(WORKSPACE_ROOT, 'job-'));
      if (identity) await identity.bind(WORKSPACE_ROOT, jobDirectory);
      await chmod(jobDirectory, 0o700);
      await stageFiles(jobDirectory, payload.inputFiles);
      await mkdir(path.join(jobDirectory, 'home'), { recursive: true });
      await mkdir(path.join(jobDirectory, 'tmp'), { recursive: true, mode: 0o777 });
      const file = path.join(jobDirectory, `run-${Date.now()}.${language === 'python' ? 'py' : 'mjs'}`);
      await writeFile(file, payload.code, 'utf8');
      if (identity) await prepareJobIdentity(jobDirectory, identity);
      const pythonPackages = path.join(jobDirectory, 'python-packages');
      const env = environment(jobDirectory, pythonPackages);
      if (identity) Object.assign(env, { USER: identity.name, LOGNAME: identity.name });
      const execution = {
        language,
        packages,
        jobDirectory,
        executable: language === 'python' ? pythonExecutable() : NODE_EXECUTABLE,
        env,
        signal,
        identity,
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
        identity,
      });
      if (identity) await identity.drain();
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
        // Failed code may never reach the declared outputs. Keep its exit code
        // and stderr while still returning any files it produced before failing.
        files: !result.aborted && !result.timedOut ? await collectFiles(jobDirectory, payload.outputFiles, { allowMissing: result.exitCode !== 0 }) : [],
      };
    } finally {
      if (identity) await identity.release();
      else if (jobDirectory) await rm(jobDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(() => undefined);
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
        requireIsolationPlatform();
        await mkdir(WORKSPACE_ROOT, {recursive:true});
        if (isolated) {
          await validateIsolation();
          const probe = landlockProbe(pythonExecutable(), WORKSPACE_ROOT);
          try { execFileSync(probe.executable, probe.args, { timeout: 3000 }); }
          catch (error) { throw new Error(error.stderr?.toString().trim().split('\n').at(-1) || 'Linux sandbox isolation probe failed.'); }
        }
        const results = await Promise.all([NODE_EXECUTABLE, pythonExecutable()].map(executable => runBoundedProcess({
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

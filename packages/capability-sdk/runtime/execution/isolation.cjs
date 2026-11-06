const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const { createInterface } = require('node:readline');
const { setTimeout: delay } = require('node:timers/promises');

const identities = Array.from({ length: 16 }, (_, index) => ({
  uid: 10001 + index, gid: 10001 + index, name: index ? `sandbox-${index + 1}` : 'sandbox',
}));
const reserved = new Set();
const lockRoot = () => path.join(os.tmpdir(), 'capability-sandbox-identities');
const helperEnvironment = () => ({ PATH: process.env.PATH, TMPDIR: os.tmpdir() });

async function validateRootAncestry(directory) {
  for (let current = path.resolve(directory); ; current = path.dirname(current)) {
    const info = await fs.lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== 0 || ((info.mode & 0o022) && !(info.mode & 0o1000))) throw new Error('Sandbox paths require root-owned ancestors without unprotected write access.');
    if (path.dirname(current) === current) return;
  }
}

function provisionSandboxIdentities() {
  if (process.platform !== 'linux' || process.getuid() !== 0) throw new Error('Sandbox identities require a Linux root image build.');
  for (const identity of identities) {
    const groups = syncFs.readFileSync('/etc/group', 'utf8').split('\n').map(line => line.split(':'));
    const group = groups.find(row => Number(row[2]) === identity.gid || row[0] === identity.name);
    if (group && (group[0] !== identity.name || Number(group[2]) !== identity.gid)) throw new Error('Sandbox group conflicts with an existing account.');
    if (!group) execFileSync('groupadd', ['--gid', String(identity.gid), identity.name]);
    const users = syncFs.readFileSync('/etc/passwd', 'utf8').split('\n').map(line => line.split(':'));
    const user = users.find(row => Number(row[2]) === identity.uid || row[0] === identity.name);
    if (user && (user[0] !== identity.name || Number(user[2]) !== identity.uid || Number(user[3]) !== identity.gid)) throw new Error('Sandbox user conflicts with an existing account.');
    if (!user) execFileSync('useradd', ['--no-create-home', '--uid', String(identity.uid), '--gid', String(identity.gid), '--shell', '/usr/sbin/nologin', identity.name]);
  }
}

let validation;
async function validateIsolation() {
  validation ||= (async () => {
    if (process.getuid() !== 0) throw new Error('The isolated Linux runner needs a root coordinator; jobs run under separate unprivileged users.');
    const status = await fs.readFile('/proc/self/status', 'utf8');
    const capabilities = BigInt('0x' + (/^CapEff:\s*([0-9a-f]+)/mi.exec(status)?.[1] || '0'));
    if (!/^NoNewPrivs:\s*1$/m.test(status) || [0, 1, 5, 6, 7].some(bit => !(capabilities & (1n << BigInt(bit))))) {
      throw new Error('Linux sandbox isolation requires no-new-privileges and coordinator CHOWN, DAC_OVERRIDE, KILL, SETGID, SETUID capabilities.');
    }
    const users = (await fs.readFile('/etc/passwd', 'utf8')).split('\n').map(line => line.split(':'));
    if (identities.some(identity => !users.some(row => row[0] === identity.name && Number(row[2]) === identity.uid && Number(row[3]) === identity.gid))) {
      throw new Error('Provision the sandbox identity pool when building the runner image.');
    }
    execFileSync('flock', ['--version'], { stdio: 'ignore', timeout: 3000 });
    await fs.mkdir(lockRoot(), { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const info = await fs.lstat(lockRoot());
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== 0 || (info.mode & 0o077)) throw new Error('Sandbox lease directory must be a private root-owned directory.');
    await validateRootAncestry(lockRoot());
  })().catch(error => { validation = undefined; throw error; });
  return validation;
}

async function liveIdentityProcesses(uid) {
  const live = [];
  for (const pid of await fs.readdir('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    const status = await fs.readFile(`/proc/${pid}/status`, 'utf8').catch(error => {
      if (['ENOENT', 'ESRCH'].includes(error.code)) return '';
      throw error;
    });
    if (Number(/^Uid:\s*(\d+)/m.exec(status)?.[1]) === uid && !/^State:\s*[ZX]/m.test(status)) live.push(pid);
  }
  return live;
}

async function stopIdentityProcesses(identity) {
  const deadline = Date.now() + 5000;
  do {
    // Linux kill(-1) runs as the leased user, so the kernel cannot signal
    // another task's user or the root coordinator, including during PID reuse.
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', "try{process.kill(-1,'SIGKILL')}catch(e){if(!['ESRCH','EPERM'].includes(e.code))throw e}"], {
        uid: identity.uid, gid: identity.gid, env: helperEnvironment(), stdio: 'ignore',
      });
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve() : reject(new Error('Unable to stop sandbox identity processes.')));
    });
    if (!(await liveIdentityProcesses(identity.uid)).length) return;
    await delay(25);
  } while (Date.now() < deadline);
  throw new Error('Sandbox identity still has live processes; refusing to reuse it.');
}

async function validateWorkspace(record, expectedUid) {
  if (record?.version !== 1 || record.uid !== expectedUid || typeof record.root !== 'string' || typeof record.directory !== 'string') throw new Error('Invalid sandbox workspace journal.');
  const root = path.resolve(record.root), directory = path.resolve(record.directory);
  if (path.dirname(directory) !== root || !/^job-[a-zA-Z0-9]+$/.test(path.basename(directory))) throw new Error('Sandbox cleanup target is outside its workspace.');
  const rootInfo = await fs.lstat(root).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (!rootInfo) return false;
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || rootInfo.uid !== 0 || (rootInfo.mode & 0o022) || await fs.realpath(root) !== root) throw new Error('Unsafe sandbox workspace root.');
  await validateRootAncestry(root);
  const info = await fs.lstat(directory).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (!info) return false;
  if (!info.isDirectory() || info.isSymbolicLink() || ![0, expectedUid].includes(info.uid) || await fs.realpath(directory) !== directory) throw new Error('Unsafe sandbox job directory.');
  return true;
}

async function removeWorkspace(record, uid) {
  if (!record || !await validateWorkspace(record, uid)) return;
  const claimDirectories = async directory => {
    // Jobs have stopped. Do not follow links, and remove sticky-directory
    // ownership barriers without granting FOWNER to the coordinator.
    await fs.chown(directory, 0, 0);
    await fs.chmod(directory, 0o700);
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) await claimDirectories(path.join(directory, entry.name));
    }
  };
  await claimDirectories(record.directory);
  await fs.rm(record.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}

async function holdIdentity(uid, filename) {
  const identity = identities.find(item => item.uid === uid);
  if (!identity || filename !== path.join(lockRoot(), `${uid}.lock`)) throw new Error('Invalid sandbox identity lease.');
  await validateIsolation();
  let record;
  const previous = await fs.readFile(filename, 'utf8');
  if (previous.trim()) record = JSON.parse(previous);
  await stopIdentityProcesses(identity);
  await removeWorkspace(record, uid);
  record = undefined;
  await fs.writeFile(filename, '');
  await fs.chmod(filename, 0o600);
  const write = value => new Promise((resolve, reject) => process.stdout.write(JSON.stringify(value) + '\n', error => error ? reject(error) : resolve()));
  let queue = Promise.resolve(), closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    queue = queue.then(async () => {
      await stopIdentityProcesses(identity);
      await removeWorkspace(record, uid);
      await fs.writeFile(filename, '');
      process.exit(0);
    }).catch(error => { console.error(error.message); process.exit(1); });
  };
  const lines = createInterface({ input: process.stdin });
  lines.on('line', line => {
    if (closing) return;
    queue = queue.then(async () => {
      const message = JSON.parse(line);
      if (message.action === 'bind') {
        const next = { version: 1, uid, root: message.root, directory: message.directory };
        if (record || !await validateWorkspace(next, uid)) throw new Error('Unable to bind sandbox workspace.');
        await fs.writeFile(filename, JSON.stringify(next));
        record = next;
      } else if (message.action === 'drain') await stopIdentityProcesses(identity);
      else if (message.action === 'release') {
        await stopIdentityProcesses(identity);
        await removeWorkspace(record, uid);
        await fs.writeFile(filename, '');
        await write({ id: message.id });
        process.exit(0);
      } else throw new Error('Invalid sandbox lease operation.');
      await write({ id: message.id });
    }).catch(error => { console.error(error.message); shutdown(); });
  });
  lines.once('close', shutdown);
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  await write({ ready: true });
}

function tryIdentity(identity, signal) {
  return new Promise((resolve, reject) => {
    const filename = path.join(lockRoot(), `${identity.uid}.lock`);
    const child = spawn('flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '75', '--no-fork', filename, process.execPath, __filename, '--hold', String(identity.uid), filename], {
      env: helperEnvironment(), stdio: ['pipe', 'pipe', 'pipe'],
    });
    let ready = false, closed = false, releasing = false, sequence = 0, stderr = '';
    const lost = new AbortController();
    const pending = new Map();
    let closeResolve;
    const completion = new Promise(done => { closeResolve = done; });
    const fail = error => { if (!ready) reject(error); for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); };
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.stdin.on('error', error => fail(error));
    const abort = () => child.stdin.end();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { child.kill('SIGKILL'); fail(new Error('Sandbox identity lease timed out.')); }, 10000);
    const request = (action, extra = {}) => new Promise((done, failed) => {
      if (closed) { failed(new Error('Sandbox identity lease was lost.')); return; }
      const id = ++sequence;
      const timeout = setTimeout(() => { child.kill('SIGKILL'); fail(new Error('Sandbox identity operation timed out.')); }, 30000);
      pending.set(id, { resolve: done, reject: failed, timer: timeout });
      child.stdin.write(JSON.stringify({ id, action, ...extra }) + '\n', error => {
        if (error) { clearTimeout(timeout); pending.delete(id); failed(error); }
      });
    });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { child.kill('SIGKILL'); fail(new Error('Invalid sandbox identity response.')); return; }
      if (message.ready && !ready) {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) { child.stdin.end(); reject(signal.reason); return; }
        ready = true;
        resolve({ ...identity, signal: lost.signal, bind: (root, directory) => request('bind', { root, directory }), drain: () => request('drain'),
          async release() { releasing = true; await request('release'); if (await completion !== 0) throw new Error('Sandbox identity cleanup failed.'); } });
      } else {
        const response = pending.get(message.id);
        if (response) { clearTimeout(response.timer); response.resolve(); pending.delete(message.id); }
      }
    });
    child.once('error', fail);
    child.once('close', code => {
      closed = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); reserved.delete(identity.uid); closeResolve(code);
      if (ready && (!releasing || code !== 0)) lost.abort(new Error('Sandbox identity lease was lost.'));
      if (!ready && code === 75) resolve(null);
      else fail(new Error(stderr.trim() || 'Sandbox identity lease closed.'));
    });
  });
}

async function acquireJobIdentity(signal) {
  await validateIsolation();
  for (;;) {
    signal?.throwIfAborted();
    for (const identity of identities) {
      if (reserved.has(identity.uid)) continue;
      reserved.add(identity.uid);
      try { const lease = await tryIdentity(identity, signal); if (lease) return lease; }
      catch (error) { reserved.delete(identity.uid); throw error; }
    }
    await delay(50, undefined, { signal });
  }
}

async function prepareJobIdentity(directory, identity) {
  const visit = async current => {
    const info = await fs.lstat(current);
    if (info.isSymbolicLink()) throw new Error('Sandbox input links are not supported.');
    if (info.isDirectory()) {
      for (const entry of await fs.readdir(current)) await visit(path.join(current, entry));
    }
    await fs.chown(current, identity.uid, identity.gid);
  };
  await fs.chmod(directory, 0o700);
  await visit(directory);
}

module.exports = { acquireJobIdentity, prepareJobIdentity, validateIsolation, provisionSandboxIdentities };
if (require.main === module) {
  if (process.argv[2] === '--provision') provisionSandboxIdentities();
  else if (process.argv[2] === '--hold') void holdIdentity(Number(process.argv[3]), process.argv[4]).catch(error => { console.error(error.message); process.exit(1); });
  else throw new Error('Use --provision while building the image.');
}

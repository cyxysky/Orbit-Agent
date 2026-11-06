const fs = require('node:fs');
const path = require('node:path');

function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

function runtimePlatform() {
  const { platform, arch } = process;
  const libc = platform === 'linux'
    ? process.report.getReport().header.glibcVersionRuntime ? 'glibc' : 'musl'
    : undefined;
  return { platform, arch, libc };
}

function matches(values, current) {
  if (!values) return true;
  const entries = Array.isArray(values) ? values : [values];
  if (entries.includes(`!${current}`)) return false;
  const allowed = entries.filter(value => !value.startsWith('!'));
  return !allowed.length || allowed.includes(current) || allowed.includes('*') || allowed.includes('any');
}

function isPackageSupported(metadata, target = runtimePlatform()) {
  return matches(metadata.os, target.platform) && matches(metadata.cpu, target.arch)
    && (target.platform !== 'linux' || matches(metadata.libc, target.libc));
}

function isInside(root, file) {
  const relative = path.relative(root, file);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function directoryBytes(directory) {
  let bytes = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) bytes += directoryBytes(file);
    else if (entry.isFile()) bytes += fs.statSync(file).size;
  }
  return bytes;
}

/** Remove excluded optional packages, other platforms, and optional production debug assets. */
function pruneRuntimeDependencies(modulesDirectory, options = {}) {
  const requestedRoot = path.resolve(modulesDirectory);
  if (path.basename(requestedRoot) !== 'node_modules' || fs.lstatSync(requestedRoot).isSymbolicLink()) {
    throw new Error('Dependency pruning requires a real node_modules directory.');
  }
  const root = fs.realpathSync(requestedRoot);
  const projectRoot = path.dirname(requestedRoot);
  const manifest = readJson(path.join(projectRoot, 'package.json'));
  const excluded = new Set(manifest.runtimeDependencyPolicy?.excludedOptionalPackages || []);
  const lock = readJson(path.join(projectRoot, 'package-lock.json'));
  const target = options.target || runtimePlatform();
  const removed = [];
  const removedDirectories = new Set();

  function cleanBinEntries(directory) {
    const bin = path.join(directory, '.bin');
    if (!fs.existsSync(bin) || fs.lstatSync(bin).isSymbolicLink()) return;
    for (const entry of fs.readdirSync(bin, { withFileTypes: true })) {
      const file = path.join(bin, entry.name);
      let stale = entry.isSymbolicLink() && !fs.existsSync(file);
      if (entry.isFile() && fs.statSync(file).size <= 65536) {
        const content = fs.readFileSync(file, 'utf8');
        const targets = [...content.matchAll(/(?:%dp0%|%~dp0|\$\{?basedir\}?)[\\/]([^"\r\n]+?\.[cm]?js)["']/gi)]
          .map(match => path.resolve(bin, match[1]));
        stale = targets.length > 0 && targets.every(target => !fs.existsSync(target));
      }
      if (!stale) continue;
      if (!isInside(root, file) || !isInside(root, fs.realpathSync(bin))) throw new Error(`Invalid executable entry: ${file}`);
      const bytes = fs.lstatSync(file).size;
      if (!options.dryRun) fs.unlinkSync(file);
      removed.push({ path: path.relative(root, file).replaceAll(path.sep, '/'), bytes, reason: 'stale executable entry' });
    }
  }

  function remove(directory, reason) {
    // Check both lexical and resolved paths before every recursive removal.
    if (!isInside(root, path.resolve(directory)) || !isInside(root, fs.realpathSync(directory))) {
      throw new Error(`Refusing to prune outside node_modules: ${directory}`);
    }
    const bytes = directoryBytes(directory);
    if (!options.dryRun) fs.rmSync(directory, { recursive: true, maxRetries: 3, retryDelay: 200 });
    removedDirectories.add(directory);
    removed.push({ path: path.relative(root, directory).replaceAll(path.sep, '/'), bytes, reason });
  }

  function visitPackage(directory) {
    const metadata = readJson(path.join(directory, 'package.json'));
    // npm aliases retain the original manifest name, including platform packages.
    if (excluded.has(metadata.name)) {
      const key = path.relative(projectRoot, directory).replaceAll(path.sep, '/');
      if (lock.packages?.[key]?.optional !== true) {
        throw new Error(`Cannot exclude a required dependency: ${key}`);
      }
      remove(directory, 'excluded optional dependency');
      return;
    }
    if (!isPackageSupported(metadata, target)) {
      remove(directory, 'different platform, architecture or libc');
      return;
    }
    const prebuilds = path.join(directory, 'prebuilds');
    if (fs.existsSync(prebuilds) && !fs.lstatSync(prebuilds).isSymbolicLink()) {
      for (const entry of fs.readdirSync(prebuilds, { withFileTypes: true })) {
        const match = /^(aix|android|darwin|freebsd|linux|openbsd|sunos|win32)-(arm64|arm|ia32|loong64|mipsel|mips|ppc64|ppc|riscv64|s390x|s390|x64)(?:$|[+.-])/.exec(entry.name);
        if (entry.isDirectory() && match && (match[1] !== target.platform || match[2] !== target.arch)) {
          remove(path.join(prebuilds, entry.name), 'different prebuild platform or architecture');
        }
      }
    }
    const nested = path.join(directory, 'node_modules');
    if (fs.existsSync(nested) && !fs.lstatSync(nested).isSymbolicLink()) visitModules(nested);
  }

  function visitModules(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const file = path.join(directory, entry.name);
      if (entry.name.startsWith('@')) {
        for (const child of fs.readdirSync(file, { withFileTypes: true })) {
          if (child.isDirectory()) visitPackage(path.join(file, child.name));
        }
      } else visitPackage(file);
    }
    cleanBinEntries(directory);
  }

  visitModules(root);
  if (options.stripSourceMaps) {
    const stripSourceMaps = (directory) => {
      if (removedDirectories.has(directory)) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        // Do not follow dependency links into the source workspace or another cache.
        if (entry.isDirectory()) stripSourceMaps(file);
        else if (entry.isFile() && /\.(?:[cm]?js|css)\.map$/i.test(entry.name)) {
          if (!isInside(root, file) || !isInside(root, fs.realpathSync(file))) {
            throw new Error(`Refusing to prune outside node_modules: ${file}`);
          }
          const bytes = fs.statSync(file).size;
          if (!options.dryRun) fs.unlinkSync(file);
          removed.push({ path: path.relative(root, file).replaceAll(path.sep, '/'), bytes, reason: 'production source map' });
        }
      }
    };
    stripSourceMaps(root);
  }
  return { target, dryRun: Boolean(options.dryRun), bytes: removed.reduce((sum, item) => sum + item.bytes, 0), removed };
}

module.exports = { isPackageSupported, pruneRuntimeDependencies, runtimePlatform };

if (require.main === module) {
  const args = process.argv.slice(2);
  const flags = new Set(['--dry-run', '--strip-source-maps']);
  if (args.some(arg => arg.startsWith('--') && !flags.has(arg)) || args.filter(arg => !arg.startsWith('--')).length > 1) {
    throw new Error('Usage: prune-runtime-dependencies.cjs [node_modules] [--dry-run] [--strip-source-maps]');
  }
  console.log(JSON.stringify(pruneRuntimeDependencies(args.find(arg => !arg.startsWith('--')) || 'node_modules', {
    dryRun: args.includes('--dry-run'),
    stripSourceMaps: args.includes('--strip-source-maps'),
  }), null, 2));
}

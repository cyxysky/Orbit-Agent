/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');

const requiredProductionRuntimeEntries = [
  path.join('.next', 'BUILD_ID'),
  path.join('.next', 'required-server-files.json'),
  path.join('dist-backend', 'src', 'backend', 'http-server.js'),
  path.join('dist-backend', 'manifest.json'),
  'node_modules',
  'package.json',
  'package-lock.json',
];

function assertProductionRuntimeSource(projectRoot) {
  const missing = requiredProductionRuntimeEntries.filter((entry) => !fs.existsSync(path.join(projectRoot, entry)));
  if (missing.length) {
    throw new Error(`The production runtime source is incomplete. Missing: ${missing.join(', ')}. Run npm install and npm run build before packaging.`);
  }
}

function packagePathFromLockEntry(relativePath) {
  return path.join(...relativePath.split('/'));
}

function productionPackagePaths(projectRoot) {
  assertProductionRuntimeSource(projectRoot);
  const lockPath = path.join(projectRoot, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  if (!lock || typeof lock !== 'object' || !lock.packages || typeof lock.packages !== 'object') {
    throw new Error(`The package lock is invalid or does not contain package entries: ${lockPath}`);
  }

  const missingRequiredPackages = [];
  const packagePaths = [];
  for (const [relativePath, metadata] of Object.entries(lock.packages)) {
    if (!relativePath.startsWith('node_modules/') || !metadata || typeof metadata !== 'object' || metadata.dev === true) continue;
    const packagePath = packagePathFromLockEntry(relativePath);
    const supported = (values, current) => !Array.isArray(values) || (!values.includes('!' + current) && (!values.some(value => !value.startsWith('!')) || values.includes(current)));
    if (!supported(metadata.os, process.platform) || !supported(metadata.cpu, process.arch)) continue;
    if (fs.existsSync(path.join(projectRoot, packagePath))) {
      packagePaths.push(packagePath);
    } else if (metadata.optional !== true) {
      missingRequiredPackages.push(relativePath);
    }
  }

  if (missingRequiredPackages.length) {
    throw new Error(`Installed production dependencies are incomplete. Missing: ${missingRequiredPackages.join(', ')}. Run npm install before packaging.`);
  }
  return packagePaths;
}

function copyBuildOutput(projectRoot, target) {
  const source = path.join(projectRoot, '.next');
  const nextTarget = path.join(target, '.next');
  fs.cpSync(source, nextTarget, {
    recursive: true,
    // Turbopack places external server packages under .next/node_modules as
    // Windows junctions. A deployment package must contain their files, not
    // recreate those links: creating a symlink requires elevated privileges or
    // Developer Mode and the source project path is unavailable after deploy.
    dereference: true,
    filter: (entry) => {
      const relativePath = path.relative(source, entry);
      return relativePath !== 'cache'
        && !relativePath.startsWith(`cache${path.sep}`)
        && relativePath !== 'standalone'
        && !relativePath.startsWith(`standalone${path.sep}`)
        && runtimeFileFilter(entry);
    },
  });
}

function serverRuntimeFilePaths(projectRoot) {
  const sourceRoot = path.join(projectRoot, 'server');
  const entryPath = path.join(sourceRoot, 'webpilot-server.js');
  if (!fs.existsSync(entryPath)) {
    throw new Error(`The custom server entry is missing: ${entryPath}`);
  }

  const runtimeFiles = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile() && !entry.name.endsWith('.test.js')) {
        runtimeFiles.push(path.relative(sourceRoot, entryPath));
      }
    }
  };
  visit(sourceRoot);
  return runtimeFiles.sort();
}

function copyServerRuntime(projectRoot, target) {
  const sourceRoot = path.join(projectRoot, 'server');
  const runtimeFiles = serverRuntimeFilePaths(projectRoot);
  for (const relativePath of runtimeFiles) {
    const destination = path.join(target, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(path.join(sourceRoot, relativePath), destination);
  }
  // Runner launchers are flattened into the package root; ship their file
  // transport and npm CLI alongside them for desktop/server installations.
  const executionTarget = path.join(target, 'capability-runtime', 'execution');
  fs.cpSync(path.join(projectRoot, 'packages', 'capability-sdk', 'runtime', 'execution'), executionTarget, { recursive: true });
  const npmCli = [process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')]
    .find(file => file && path.basename(file) === 'npm-cli.js' && fs.existsSync(file));
  if (!npmCli) throw new Error('npm CLI is required to package the code Runner. Invoke packaging through npm.');
  fs.cpSync(path.resolve(npmCli, '..', '..'), path.join(executionTarget, 'npm'), { recursive: true });
  return runtimeFiles;
}

function runtimeFileFilter(entry) {
  const parts = entry.split(/[\\/]/);
  return !parts.some(part => ['.cache', '__pycache__', '.git'].includes(part))
    && !/\.(?:map|pyc|pyo)$/.test(entry);
}

function copyProductionRuntime(projectRoot, target) {
  const packagePaths = productionPackagePaths(projectRoot);
  const resolvedTarget = path.resolve(target);
  if (!resolvedTarget.startsWith(path.resolve(projectRoot) + path.sep)) throw new Error('Package target must be inside project output.');
  fs.rmSync(resolvedTarget, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });

  copyBuildOutput(projectRoot, target);
  fs.cpSync(path.join(projectRoot, 'dist-backend'), path.join(target, 'dist-backend'), { recursive: true });
  fs.cpSync(path.join(projectRoot, 'package.json'), path.join(target, 'package.json'));
  const envSource = path.join(projectRoot, '.env.example');
  if (fs.existsSync(envSource)) fs.cpSync(envSource, path.join(target, '.env.example'));

  for (const packagePath of packagePaths) {
    const source = path.join(projectRoot, packagePath);
    const destination = path.join(target, packagePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const workspace = fs.lstatSync(source).isSymbolicLink();
    if (workspace) {
      // npm's publish file list avoids copying workspace source and private data.
      const { execFileSync } = require('node:child_process');
      const npmCli = process.env.npm_execpath;
      if (!npmCli) throw new Error('Package through npm so its publish file list is available.');
      const pack = JSON.parse(execFileSync(process.execPath, [npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: fs.realpathSync(source), encoding: 'utf8' }))[0];
      for (const { path: file } of pack.files) {
        if (!runtimeFileFilter(file)) continue;
        const output = path.join(destination, file);
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.copyFileSync(path.join(source, file), output);
      }
    } else {
      fs.cpSync(source, destination, { recursive: true, dereference: true, filter: runtimeFileFilter });
    }
  }
  return packagePaths;
}

module.exports = {
  assertProductionRuntimeSource,
  copyProductionRuntime,
  copyServerRuntime,
  productionPackagePaths,
  requiredProductionRuntimeEntries,
  serverRuntimeFilePaths,
};

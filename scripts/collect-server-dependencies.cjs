const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

/** Trace the custom backend as well as Next. No tool installation occurs here. */
async function collectServerDependencies(projectRoot, destination) {
  const root = fs.realpathSync(projectRoot);
  const target = path.resolve(destination);
  if (target === root || !target.startsWith(root + path.sep)) throw new Error('Dependency destination must be inside the release workspace.');
  const requireRoot = createRequire(path.join(root, 'package.json'));
  const { nodeFileTrace } = requireRoot('next/dist/compiled/@vercel/nft');
  const layout = JSON.parse(fs.readFileSync(path.join(root, 'dist-backend', 'tool-dependencies.json'), 'utf8'));
  const optional = new Set(layout.optional);
  const excluded = new Set(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).runtimeDependencyPolicy?.excludedOptionalPackages || []);
  function dependencyName(relative) {
    const index = relative.lastIndexOf('node_modules/');
    if (index < 0) return undefined;
    const name = relative.slice(index + 'node_modules/'.length);
    return name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
  }
  function allowed(relative) {
    relative = relative.replaceAll('\\', '/');
    const name = dependencyName(relative);
    return !optional.has(name) && !excluded.has(name)
      && !/^(?:\.data|\.git|\.cache|runtime|\.tmp|tmp|artifacts|uploads)(?:\/|$)/.test(relative)
      && !/(?:^|\/)(?:\.cache|__tests__|test-results)(?:\/|$)/.test(relative)
      && !/(?:^|\/)\.env(?:\.|$)/.test(relative)
      && !/\.(?:map|pdb|obj|lib|exp|pyc|pyo)$/.test(relative);
  }
  const entries = [
    // The custom launcher resolves these through a runtime createRequire callback.
    requireRoot.resolve('next'), requireRoot.resolve('@next/env'),
    // TypeORM chooses these drivers from persisted deployment configuration.
    requireRoot.resolve('better-sqlite3'), requireRoot.resolve('pg'),
    path.join(root, 'dist-backend', 'src', 'backend', 'http-server.js'),
    ...fs.readdirSync(path.join(root, 'server')).filter(file => /\.[cm]?js$/.test(file) && !file.endsWith('.test.js'))
      .map(file => path.join(root, 'server', file)),
    path.join(root, 'next.config.ts'),
  ];
  const traced = await nodeFileTrace(entries, { base: root, processCwd: root,
    ignore: relative => !allowed(relative) || relative.startsWith('node_modules/electron/') });
  const files = new Set([...traced.fileList].filter(relative => relative.startsWith('node_modules/') && allowed(relative)));
  function traces(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory() && !['cache', 'standalone', 'node_modules'].includes(entry.name)) traces(filename);
      else if (entry.isFile() && entry.name.endsWith('.nft.json')) {
        const trace = JSON.parse(fs.readFileSync(filename, 'utf8'));
        for (const relative of trace.files || []) {
          const absolute = path.resolve(path.dirname(filename), relative);
          if (!absolute.startsWith(root + path.sep)) continue;
          const local = path.relative(root, absolute).replaceAll(path.sep, '/');
          if (local.startsWith('node_modules/') && allowed(local)) files.add(local);
        }
      }
    }
  }
  traces(path.join(root, '.next'));
  // Package boundaries are needed for ESM resolution even when only a few files are traced.
  for (const relative of [...files]) {
    let directory = path.dirname(path.join(root, relative));
    while (directory.startsWith(path.join(root, 'node_modules') + path.sep)) {
      const manifest = path.join(directory, 'package.json');
      const local = path.relative(root, manifest).replaceAll(path.sep, '/');
      if (fs.existsSync(manifest) && allowed(local)) files.add(local);
      directory = path.dirname(directory);
    }
  }
  // The installer uses npm's tar reader; the Node base image supplies npm itself.
  let bytes = 0;
  for (const relative of [...files].sort()) {
    const source = path.join(root, relative);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
    const output = path.resolve(target, relative);
    if (!output.startsWith(target + path.sep)) throw new Error('Traced dependency escapes the release directory.');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(source, output);
    bytes += fs.statSync(source).size;
  }
  // Keep package licences alongside the traced portions of a dependency.
  for (const relative of [...files].filter(file => file.endsWith('/package.json'))) {
    const directory = path.dirname(path.join(root, relative));
    for (const entry of fs.readdirSync(directory)) if (/^(?:licen[cs]e|copying|notice)(?:\.|$)/i.test(entry)) {
      const source = path.join(directory, entry);
      if (fs.statSync(source).isFile()) {
        const output = path.join(target, path.relative(root, source));
        fs.mkdirSync(path.dirname(output), { recursive: true }); fs.copyFileSync(source, output);
      }
    }
  }
  return { files: files.size, bytes, optionalTools: Object.keys(layout.components), excludedPackages: [...optional] };
}
module.exports = { collectServerDependencies };
if (require.main === module) {
  const root = process.cwd();
  collectServerDependencies(root, process.argv[2] || path.join(root, '.server-runtime')).then(result => {
    fs.writeFileSync(path.join(root, '.server-runtime-report.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  }).catch(error => { console.error(error); process.exitCode = 1; });
}

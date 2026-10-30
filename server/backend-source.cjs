/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');

function sourceResolver(root, paths) {
  const aliases = Object.entries(paths).sort(([a], [b]) => b.length - a.length);
  function file(candidate) {
    for (const value of [candidate, `${candidate}.ts`, `${candidate}.tsx`, `${candidate}.js`, `${candidate}.mjs`, path.join(candidate, 'index.ts'), path.join(candidate, 'index.js')]) {
      if (fs.existsSync(value) && fs.statSync(value).isFile()) return value;
    }
  }
  return (specifier, parent) => {
    if (specifier.startsWith('.')) return file(path.resolve(path.dirname(parent), specifier));
    for (const [alias, targets] of aliases) {
      const wildcard = alias.indexOf('*');
      const match = wildcard < 0 ? specifier === alias : specifier.startsWith(alias.slice(0, wildcard)) && specifier.endsWith(alias.slice(wildcard + 1));
      if (!match) continue;
      const value = wildcard < 0 ? '' : specifier.slice(wildcard, specifier.length - (alias.length - wildcard - 1));
      for (const target of targets) {
        const resolved = file(path.resolve(root, target.replace('*', value)));
        if (resolved) return resolved;
      }
    }
  };
}

function backendConfigPath(root) {
  const configName = process.env.WEBPILOT_CAPABILITY_SOURCE === 'npm' || process.env.ORBIT_CAPABILITY_SOURCE === 'npm' ? 'tsconfig.npm.json' : 'tsconfig.json';
  return path.join(root, configName);
}

function readBackendConfiguration(root, ts, readFile = ts.sys.readFile) {
  const config = ts.readConfigFile(backendConfigPath(root), readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, { ...ts.sys, readFile }, root);
  return { ...parsed.options, plugins: [], incremental: false, noEmit: false, declaration: false,
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, sourceMap: true,
    inlineSources: true, rewriteRelativeImportExtensions: false };
}

function backendCompilerOptions(root, ts) {
  return readBackendConfiguration(root, ts);
}

// Long-lived development loaders must see newly declared aliases. Track the
// configuration and its extends chain; do not reparse it on every module load.
function backendSourceConfiguration(root, ts) {
  let cached;
  const revision = (filename) => {
    const stat = fs.statSync(filename, { throwIfNoEntry: false });
    return stat ? `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}` : '';
  };
  return () => {
    const configPath = backendConfigPath(root);
    if (cached?.configPath === configPath
      && [...cached.revisions].every(([filename, value]) => revision(filename) === value)) return cached;
    const revisions = new Map();
    const options = readBackendConfiguration(root, ts, filename => {
      revisions.set(filename, revision(filename));
      return ts.sys.readFile(filename);
    });
    cached = { configPath, revisions, options, resolve: sourceResolver(root, options.paths || {}) };
    return cached;
  };
}

module.exports = { sourceResolver, backendCompilerOptions, backendSourceConfiguration };

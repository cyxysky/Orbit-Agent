const fs = require('node:fs');
const path = require('node:path');

function runtimeDirectory(environment = process.env) {
  return path.resolve(environment.CAPABILITY_RUNTIME_HOME || path.join(process.cwd(), '.capability-sdk', `${process.platform}-${process.arch}`));
}

// Manifests store paths relative to their own runtime directory. Consumers receive
// validated absolute paths so no tool has to know how the SDK was installed.
function resolveRuntimePath(directory, filename) {
  if (typeof filename !== 'string' || !filename.trim()) return undefined;
  const resolved = path.resolve(directory, filename);
  const relative = path.relative(directory, resolved);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || !fs.existsSync(resolved)) return undefined;
  return resolved;
}

function readManagedRuntime(environment = process.env) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(runtimeDirectory(environment), 'runtime.json'), 'utf8'));
    if (value.format !== 2 || value.platform !== process.platform || value.arch !== process.arch || value.status !== 'ready') return undefined;
    const directory = runtimeDirectory(environment);
    let available = 0;
    for (const key of ['python', 'libreoffice', 'unoPython', 'chromium', 'ffmpeg']) {
      if (!(key in value)) continue;
      value[key] = resolveRuntimePath(directory, value[key]);
      if (!value[key]) { delete value[key]; continue; }
      available++;
    }
    return available ? value : undefined;
  } catch { return undefined; }
}

function managedModelDirectory(key, requested = '', environment = process.env) {
  const defaults = require('./spec.json').models;
  if (requested && requested !== defaults[key]) return '';
  return readManagedSensitiveDataRuntime(environment)?.models?.[key] || '';
}

function readManagedSensitiveDataRuntime(environment = process.env) {
  environment = { ...environment, CAPABILITY_RUNTIME_HOME: environment.CAPABILITY_SENSITIVE_DATA_RUNTIME_HOME || environment.CAPABILITY_RUNTIME_HOME };
  let value;
  const directory = runtimeDirectory(environment);
  try {
    value = JSON.parse(fs.readFileSync(path.join(directory, 'sensitive-data.json'), 'utf8'));
    if (value.format !== 1 || value.platform !== process.platform || value.arch !== process.arch || value.status !== 'ready') return undefined;
  } catch { return undefined; }
  if (!value) return undefined;
  value.python = resolveRuntimePath(directory, value.python);
  if (!value.python) return undefined;
  for (const key of Object.keys(value.models || {})) {
    value.models[key] = resolveRuntimePath(directory, value.models[key]);
    if (!value.models[key]) return undefined;
  }
  for (const key of ['gliner', 'chinese', 'pii']) {
    const model = value.models?.[key];
    if (!model || !fs.existsSync(path.join(model, 'config.json')) || !fs.readdirSync(model).some(name => /\.(safetensors|bin)$/.test(name))) return undefined;
  }
  return value;
}

module.exports = { runtimeDirectory, readManagedRuntime, readManagedSensitiveDataRuntime, managedModelDirectory };

const fs = require('node:fs');
const path = require('node:path');

function runtimeDirectory(environment = process.env) {
  return path.resolve(environment.CAPABILITY_RUNTIME_HOME || path.join(process.cwd(), '.capability-sdk', `${process.platform}-${process.arch}`));
}

function readManagedRuntime(environment = process.env) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(runtimeDirectory(environment), 'runtime.json'), 'utf8'));
    if (value.format !== 2 || value.platform !== process.platform || value.arch !== process.arch || value.status !== 'ready') return undefined;
    const directory = runtimeDirectory(environment);
    for (const filename of [value.python, value.libreoffice, value.unoPython, value.chromium, value.ffmpeg, ...Object.values(value.models || {})]) {
      if (typeof filename !== 'string' || !path.isAbsolute(filename)) return undefined;
      const relative = path.relative(directory, filename);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
    }
    return value;
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
  } catch { value = readManagedRuntime(environment); }
  if (!value) return undefined;
  for (const filename of [value.python, ...Object.values(value.models || {})]) {
    if (typeof filename !== 'string' || !path.isAbsolute(filename)) return undefined;
    const relative = path.relative(directory, filename);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(filename)) return undefined;
  }
  for (const key of ['gliner', 'chinese', 'pii']) {
    const model = value.models?.[key];
    if (!model || !fs.existsSync(path.join(model, 'config.json')) || !fs.readdirSync(model).some(name => /\.(safetensors|bin)$/.test(name))) return undefined;
  }
  return value;
}

module.exports = { runtimeDirectory, readManagedRuntime, readManagedSensitiveDataRuntime, managedModelDirectory };

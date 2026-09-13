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
  return readManagedRuntime(environment)?.models?.[key] || '';
}

module.exports = { runtimeDirectory, readManagedRuntime, managedModelDirectory };

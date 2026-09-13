const path = require('node:path');
const { mkdir, readdir, lstat, realpath, readFile, writeFile } = require('node:fs/promises');

const MAX_FILES = 16;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;

function relativeFile(value) {
  if (typeof value !== 'string' || value.length > 500 || /[\\:\x00-\x1f]/.test(value)
    || value.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('File paths must be relative paths with no traversal, drive letters or backslashes.');
  }
  return value;
}

function decodeFile(file) {
  if (typeof file.base64 !== 'string' || file.base64.length > Math.ceil(MAX_FILE_BYTES / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64)) {
    throw new Error('Invalid or oversized file payload (maximum 10 MB per file).');
  }
  const bytes = Buffer.from(file.base64, 'base64');
  if (bytes.length > MAX_FILE_BYTES) throw new Error('File exceeds 10 MB.');
  return bytes;
}

async function stageFiles(directory, files = []) {
  if (!Array.isArray(files) || files.length > MAX_FILES) throw new Error('At most 16 input files are allowed.');
  let total = 0;
  for (const file of files) {
    const relative = relativeFile(file.path);
    if (!relative.startsWith('inputs/')) throw new Error('Input files must be placed under inputs/.');
    const bytes = decodeFile(file);
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) throw new Error('Input files exceed 32 MB in total.');
    const destination = path.join(directory, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: 'wx', mode: 0o644 });
  }
  await mkdir(path.join(directory, 'outputs'), { recursive: true, mode: 0o777 });
}

async function collectFiles(directory, requested = []) {
  if (!Array.isArray(requested) || requested.length > MAX_FILES) throw new Error('At most 16 output files are allowed.');
  const names = new Set(requested.map(relativeFile));
  const root = await realpath(directory);
  async function walk(relative, depth = 0) {
    if (depth > 8) throw new Error('Output directory nesting exceeds 8 levels.');
    const full = path.join(directory, relative);
    const info = await lstat(full).catch(error => error.code === 'ENOENT' ? undefined : Promise.reject(error));
    if (!info) return;
    if (info.isSymbolicLink()) throw new Error('Output symlinks are not supported.');
    if (!info.isDirectory()) throw new Error('outputs must be a directory.');
    const entries = await readdir(full, { withFileTypes: true });
    if (entries.length > 256) throw new Error('Output directory contains too many entries.');
    for (const entry of entries) {
      const name = relativeFile(`${relative}/${entry.name}`);
      if (entry.isSymbolicLink()) throw new Error('Output symlinks are not supported.');
      if (entry.isDirectory()) await walk(name, depth + 1);
      else if (entry.isFile()) names.add(name);
      else throw new Error('Only regular output files are supported.');
      if (names.size > MAX_FILES) throw new Error('At most 16 output files are allowed.');
    }
  }
  await walk('outputs');
  let total = 0;
  const files = [];
  for (const name of names) {
    const full = path.join(directory, name);
    const resolved = await realpath(full);
    const relative = path.relative(root, resolved);
    const info = await lstat(full);
    if (relative.startsWith('..') || path.isAbsolute(relative) || info.isSymbolicLink() || !info.isFile()) throw new Error('Output file must be a regular file inside this workspace.');
    if (info.size > MAX_FILE_BYTES) throw new Error(`Output file ${name} exceeds 10 MB.`);
    const bytes = await readFile(full);
    total += bytes.length;
    if (bytes.length > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) throw new Error('Output files exceed the 10 MB per-file / 32 MB total limit.');
    files.push({ path: name, size: bytes.length, base64: bytes.toString('base64') });
  }
  return files;
}

module.exports = { collectFiles, stageFiles, decodeFile, relativeFile, MAX_TOTAL_BYTES };

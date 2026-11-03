#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFile, lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const source = fileURLToPath(new URL('../', import.meta.url));
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  output: { type: 'string' }, version: { type: 'string' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
} });
if (values.help) {
  console.log('Usage: node scripts/export-repository.mjs --output <new-directory> [--version 0.3.1] [--dry-run]\nCopies SDK source, scripts, documentation and workflows; excludes generated builds and private runtime data. The target must be empty.');
} else {
  if (positionals.length || !values.output) throw new Error('Specify --output <new-directory>. Use --help.');
  if (values.version && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(values.version)) throw new Error('--version must be an exact semantic version.');
  const output = path.resolve(values.output);
  const contains = (parent, child) => { const relative = path.relative(parent, child); return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
  if (contains(source, output) || contains(output, source)) throw new Error('Output must be separate from the source package and its parent directories.');
  try {
    const target = await lstat(output);
    if (!target.isDirectory() || target.isSymbolicLink() || (await readdir(output)).length) throw new Error('Output already exists and is not an empty regular directory. Choose a new directory; nothing was overwritten.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const directories = new Set(['src', 'scripts', 'runtime', 'docs', 'licenses', 'examples', '.github']);
  const rootFiles = new Set(['package.json', 'tsconfig.build.json', 'mcp-config.schema.json', '.gitignore', '.gitattributes', 'LICENSE', 'NOTICE']);
  const files = [];
  async function collect(directory, relative = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (!relative && !directories.has(entry.name) && !rootFiles.has(entry.name)
        && !/\.md$/.test(entry.name) && !/^install\.(mjs|sh|ps1|cmd)$/.test(entry.name)) continue;
      if (entry.isSymbolicLink()) throw new Error(`SDK export does not follow symlinks: ${name}`);
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', '__pycache__', '.git'].includes(entry.name)) await collect(path.join(directory, entry.name), name);
      } else if (entry.isFile() && name !== 'runtime/ui/viewer.html' && !/\.(pyc|pyo|log|tgz|tsbuildinfo)$/.test(entry.name)) files.push(name);
    }
  }
  await collect(source);
  files.sort();
  const manifest = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
  if (values.version) manifest.version = values.version;
  const report = { package: manifest.name, version: manifest.version, files: files.length,
    output, builtArtifactsIncluded: false, source: 'Current SDK working tree, including local changes',
    license: manifest.license || 'Pending owner selection' };
  if (!values['dry-run']) {
    await mkdir(output, { recursive: true });
    for (const file of files) {
      const destination = path.join(output, file);
      await mkdir(path.dirname(destination), { recursive: true });
      if (file === 'package.json') await writeFile(destination, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
      else await copyFile(path.join(source, file), destination);
    }
    // Record origin without local usernames, filesystem paths, database contents or Git history.
    const { output: ignoredOutput, ...origin } = report;
    await writeFile(path.join(output, 'REPOSITORY-ORIGIN.json'), JSON.stringify(origin, null, 2) + '\n', { flag: 'wx' });
  }
  console.log(JSON.stringify({ ...report, dryRun: Boolean(values['dry-run']) }, null, 2));
}

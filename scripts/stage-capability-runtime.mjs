import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const source = String(process.argv[2] || 'workspace').trim().toLowerCase();
if (source !== 'workspace' && source !== 'npm') {
  throw new Error('Capability source must be "workspace" or "npm".');
}

const root = process.cwd();
const stagingRoot = path.join(root, '.capability-runtime');
await rm(stagingRoot, { recursive: true, force: true });
await mkdir(stagingRoot, { recursive: true });

const packageRoot = source === 'npm'
  ? path.join(root, 'node_modules', '@cjfclonedeep', 'capability-sdk')
  : path.join(root, 'packages', 'capability-sdk');
for (const name of ['file', 'browser', 'computer', 'sensitive-data']) {
  await cp(path.join(packageRoot, 'runtime', name), path.join(stagingRoot, name), {
    recursive: true,
  });
}

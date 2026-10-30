import { readFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';

const source = path.resolve(process.argv[2] || process.cwd());
const output = path.resolve(process.argv[3] || path.join(source, '.workspace-manifests'));
const manifest = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
for (const workspace of manifest.workspaces || []) {
  if (!/^packages\/[a-zA-Z0-9_-]+$/.test(workspace)) throw new Error(`Unsupported workspace path: ${workspace}`);
  const destination = path.join(output, workspace);
  await mkdir(destination, { recursive: true });
  await copyFile(path.join(source, workspace, 'package.json'), path.join(destination, 'package.json'));
  if (workspace === 'packages/capability-sdk') {
    // npm still invokes postinstall in the manifest-only Docker dependency layer.
    // These bootstrap files allow the explicitly skipped lifecycle to run before COPY . .
    for (const filename of ['scripts/runtime.cjs', 'runtime/managed/layout.cjs', 'runtime/managed/spec.json']) {
      const target = path.join(destination, filename);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(source, workspace, filename), target);
    }
  }
}

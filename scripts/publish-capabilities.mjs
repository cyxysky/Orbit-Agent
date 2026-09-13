import { spawnSync } from 'node:child_process';

const packages = [
  '@cjfclonedeep/capability-sdk',
];
const dryRun = process.argv.includes('--dry-run');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmCli = process.env.npm_execpath;

for (const packageName of packages) {
  const args = [
    'publish',
    '--workspace', packageName,
    '--access', 'public',
    ...(dryRun ? ['--dry-run'] : []),
  ];

  const result = npmCli
    ? spawnSync(process.execPath, [npmCli, ...args], { stdio: 'inherit' })
    : spawnSync(npm, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

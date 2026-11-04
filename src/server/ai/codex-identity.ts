import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { appDataRoot } from '@/server/storage/paths';

/** Copy login credentials into an application-owned home without personal MCP configuration. */
export async function prepareCodexIdentityHome(identity: string, copyAuthentication: boolean) {
  const directory = path.join(appDataRoot(), 'codex', identity);
  await mkdir(directory, { recursive: true });
  if (!copyAuthentication) return directory;
  const source = path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'auth.json');
  if (!existsSync(source)) return directory;
  const auth = await readFile(source);
  const digest = createHash('sha256').update(auth).digest('hex');
  const marker = path.join(directory, 'auth-source.sha256');
  const copied = await readFile(marker, 'utf8').catch(() => '');
  if (copied !== digest || !existsSync(path.join(directory, 'auth.json'))) {
    await writeFile(path.join(directory, 'auth.json'), auth, { mode: 0o600 });
    await writeFile(marker, digest);
  }
  return directory;
}

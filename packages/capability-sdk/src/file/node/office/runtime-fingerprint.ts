import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveLibreOfficeExecutable } from '../libreoffice.ts';
import { resolveUnoProgramWorker } from './uno.ts';
import { resolveOfficeJsProgramWorker } from './javascript.ts';
import { htmlOfficeRuntimeSource } from './html.ts';
import { chromium } from 'playwright';
import { managedChromiumOptions } from '../../../runtime.ts';
import type { OfficeDocumentDraft } from '../../office/types.ts';

async function fileStamp(filePath: string) {
  const value = await stat(filePath).catch(() => undefined);
  return [filePath, value?.size, value?.mtimeMs, value?.ctimeMs];
}

const fingerprintFlights = new Map<string, Promise<string>>();

async function fontInventory(root: string) {
  const entries = await readdir(root, { recursive: true }).catch(() => [] as string[]);
  const files = entries.filter((entry) => /\.(ttf|ttc|otf|otc)$/i.test(entry)).sort();
  const inventory: Awaited<ReturnType<typeof fileStamp>>[] = new Array(files.length);
  let next = 0;
  // Avoid issuing hundreds of stat operations and allocating all their promises
  // at once. Keep ordering stable so identical environments retain their digest.
  await Promise.all(Array.from({ length: Math.min(8, files.length) }, async () => {
    while (next < files.length) {
      const index = next++;
      inventory[index] = await fileStamp(path.join(root, files[index]));
    }
  }));
  return inventory;
}

/** Invalidate conversions when the renderer or installed fonts change. */
export async function officeRenderEnvironmentFingerprint() {
  const executable = await resolveLibreOfficeExecutable();
  const fontRoots = process.platform === 'win32'
    ? [path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'),
      ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts')] : [])]
    : process.platform === 'darwin'
      ? ['/System/Library/Fonts', '/Library/Fonts', path.join(os.homedir(), 'Library', 'Fonts')]
      : ['/usr/share/fonts', '/usr/local/share/fonts', path.join(os.homedir(), '.fonts'), path.join(os.homedir(), '.local', 'share', 'fonts')];
  if (executable) fontRoots.push(path.resolve(path.dirname(executable), '..', 'share', 'fonts'));
  const fontconfig = [process.env.FONTCONFIG_FILE, process.env.FONTCONFIG_PATH];
  const key = JSON.stringify({ executable, fontRoots, fontconfig });
  const existing = fingerprintFlights.get(key);
  if (existing) return existing;
  const pending = (async () => {
    const inventories = await Promise.all(fontRoots.map(fontInventory));
    const runtime = executable ? await Promise.all([
      fileStamp(executable), fileStamp(path.join(path.dirname(executable), 'version.ini')),
      fileStamp(path.join(path.dirname(executable), 'versionrc')),
    ]) : [];
    return createHash('sha256').update(JSON.stringify({ runtime, fontRoots, inventories, fontconfig })).digest('hex');
  })();
  fingerprintFlights.set(key, pending);
  try { return await pending; }
  finally { if (fingerprintFlights.get(key) === pending) fingerprintFlights.delete(key); }
}

export async function officeGenerationRuntimeFingerprint(generator: OfficeDocumentDraft['generator'] = 'uno') {
  if (generator === 'html') {
    const sources = htmlOfficeRuntimeSource();
    return createHash('sha256').update(JSON.stringify({ sources, chromium: await fileStamp(managedChromiumOptions().executablePath || chromium.executablePath()), environment: await officeRenderEnvironmentFingerprint() })).digest('hex');
  }
  const [environment, worker] = await Promise.all([
    officeRenderEnvironmentFingerprint(), generator === 'javascript' ? resolveOfficeJsProgramWorker() : resolveUnoProgramWorker(),
  ]);
  return createHash('sha256').update(environment)
    .update(worker ? await readFile(worker) : 'no-uno-worker').digest('hex');
}

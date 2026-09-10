import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveLibreOfficeExecutable } from '../libreoffice.ts';
import { resolveUnoProgramWorker } from './uno.ts';
import { resolveOfficeJsProgramWorker } from './javascript.ts';
import { htmlOfficeRuntimeSource } from './html.ts';
import { chromium } from 'playwright';
import type { OfficeDocumentDraft } from '../../office/types.ts';

async function fileStamp(filePath: string) {
  const value = await stat(filePath).catch(() => undefined);
  return [filePath, value?.size, value?.mtimeMs, value?.ctimeMs];
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
  const inventories = await Promise.all(fontRoots.map(async (root) => {
    const entries = await readdir(root, { recursive: true }).catch(() => [] as string[]);
    const files = entries.filter((entry) => /\.(ttf|ttc|otf|otc)$/i.test(entry)).sort();
    return Promise.all(files.map((entry) => fileStamp(path.join(root, entry))));
  }));
  const runtime = executable ? await Promise.all([
    fileStamp(executable), fileStamp(path.join(path.dirname(executable), 'version.ini')),
    fileStamp(path.join(path.dirname(executable), 'versionrc')),
  ]) : [];
  return createHash('sha256').update(JSON.stringify({ runtime, fontRoots, inventories,
    fontconfig: [process.env.FONTCONFIG_FILE, process.env.FONTCONFIG_PATH],
  })).digest('hex');
}

export async function officeGenerationRuntimeFingerprint(generator: OfficeDocumentDraft['generator'] = 'uno') {
  if (generator === 'html') {
    const sources = htmlOfficeRuntimeSource();
    return createHash('sha256').update(JSON.stringify({ sources, chromium: await fileStamp(chromium.executablePath()), environment: await officeRenderEnvironmentFingerprint() })).digest('hex');
  }
  const [environment, worker] = await Promise.all([
    officeRenderEnvironmentFingerprint(), generator === 'javascript' ? resolveOfficeJsProgramWorker() : resolveUnoProgramWorker(),
  ]);
  return createHash('sha256').update(environment)
    .update(worker ? await readFile(worker) : 'no-uno-worker').digest('hex');
}

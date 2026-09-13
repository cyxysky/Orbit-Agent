import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileFormatForName } from '../formats.ts';
import type { FileArtifactOperationResult } from '../types.ts';
import { createNodeArtifactPayload, sanitizeNodeArtifactFileName } from './artifacts.ts';

export type NodeFileWriteInput = {
  runId?: string;
  fileName?: string;
  content?: string;
  abortSignal?: AbortSignal;
};

/** Publish literal text bytes without interpreting code or invoking an Office engine. */
export async function writeTextFileArtifact(
  store: Parameters<typeof createNodeArtifactPayload>[0],
  input: NodeFileWriteInput,
): Promise<FileArtifactOperationResult> {
  try {
    input.abortSignal?.throwIfAborted();
    const fileName = input.fileName;
    if (typeof fileName !== 'string' || !fileName.trim() || fileName.length > 180
      || /[\u0000-\u001f<>:"/\\|?*]/.test(fileName) || /[. ]$/.test(fileName)
      || fileName === '.' || fileName === '..'
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(fileName)) {
      throw new Error('write requires a valid file name, not a directory or path.');
    }
    const format = fileFormatForName(fileName);
    // Unknown extensions are allowed for source/config formats. Known binary
    // formats cannot be produced by renaming text bytes.
    if (format && format.kind !== 'text' && !/(?:^text\/|(?:\/|\+)xml(?:;|$))/.test(format.mimeType)) {
      throw new Error('write accepts text formats only. Use plan → generate → render for Office/PDF files.');
    }
    if (typeof input.content !== 'string' || input.content.length > 1_000_000) {
      throw new Error('write requires string content of at most 1,000,000 characters.');
    }
    const bytes = Buffer.from(input.content, 'utf8');
    const directory = path.join(store.artifactsRoot, sanitizeNodeArtifactFileName(input.runId, 'adhoc'), 'generated', randomUUID());
    await mkdir(directory, { recursive: true });
    const filePath = path.join(directory, fileName);
    await writeFile(filePath, bytes, { flag: 'wx', signal: input.abortSignal });
    const payload = {
      ...createNodeArtifactPayload(store, { fileName, filePath, bytes: bytes.length, kind: 'generated' }),
      mediaType: format?.mimeType || 'text/plain; charset=utf-8',
      encoding: 'utf8',
    };
    return { ok: true, actual: `Wrote ${fileName} (${bytes.length} bytes).`, data: payload };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, actual: message, error: { code: 'file-write-failed', message } };
  }
}

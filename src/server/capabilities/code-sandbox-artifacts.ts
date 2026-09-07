import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CodeSandboxArtifact, CodeSandboxExecutor, CodeSandboxTransportFile } from '@webpilot/capability-code-sandbox';
import { artifactContentType } from '@webpilot/capability-file';
import { artifactApiUrlFromRelative } from '@/lib/artifacts';
import { normalizeApplicationUserId } from '@/server/auth/user-context';
import { artifactsRoot } from '@/server/storage/paths';
import { decodeFile, MAX_TOTAL_BYTES, relativeFile } from '../../../packages/capability-code-sandbox/runtime/files.cjs';

/** Persist runner bytes before its disposable workspace disappears; never expose transport Base64 in run results. */
export function withCodeSandboxArtifacts(executor: CodeSandboxExecutor, scope: { userId?: string; runId: string; root?: string }): CodeSandboxExecutor {
  const root = path.resolve(scope.root || artifactsRoot());
  const run = scope.runId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const prefix = `uploads/${normalizeApplicationUserId(scope.userId)}/sandbox/${run}/`;
  const resolve = async (artifactId: string) => {
    relativeFile(artifactId);
    if (!artifactId.startsWith(prefix)) throw new Error('Sandbox file does not belong to this run.');
    const file = path.resolve(root, artifactId);
    const actual = await realpath(file);
    const scopedRoot = await realpath(path.join(root, prefix));
    const relative = path.relative(scopedRoot, actual);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid sandbox artifact path.');
    const info = await stat(actual);
    if (!info.isFile() || info.size > 10 * 1024 * 1024) throw new Error('Invalid or oversized sandbox artifact.');
    return { file: actual, size: info.size };
  };
  const describe = (artifactId: string, size: number): CodeSandboxArtifact => ({
    artifactId, size, fileName: path.posix.basename(artifactId), mediaType: artifactContentType(artifactId),
    url: artifactApiUrlFromRelative(artifactId), downloadUrl: `${artifactApiUrlFromRelative(artifactId)}?download=1`,
  });
  return {
    health: executor.health?.bind(executor),
    dispose: executor.dispose?.bind(executor),
    async run(execution, context) {
      const inputFiles: CodeSandboxTransportFile[] = [];
      let inputBytes = 0;
      for (const input of execution.artifactInputs || []) {
        relativeFile(input.path);
        if (!input.path.startsWith('inputs/')) throw new Error('Mount saved files under inputs/.');
        const { file, size } = await resolve(input.artifactId);
        inputBytes += size;
        if (inputBytes > MAX_TOTAL_BYTES) throw new Error('Input files exceed 32 MB in total.');
        inputFiles.push({ path: input.path, base64: (await readFile(file, { signal: context.abortSignal })).toString('base64') });
      }
      const { artifactInputs: _artifactInputs, ...transport } = execution;
      const { files = [], ...result } = await executor.run({ ...transport, inputFiles }, context);
      if (files.length > 16) throw new Error('Runner returned more than 16 files.');
      let outputBytes = 0;
      const decoded = files.map(file => {
        relativeFile(file.path);
        const bytes = decodeFile(file);
        outputBytes += bytes.length;
        if (outputBytes > MAX_TOTAL_BYTES) throw new Error('Runner files exceed 32 MB in total.');
        return { file, bytes };
      });
      const artifacts: CodeSandboxArtifact[] = [];
      for (const { file, bytes } of decoded) {
        const fileName = path.posix.basename(file.path).replace(/[<>:"|?*\x00-\x1f]/g, '_');
        const artifactId = `${prefix}${randomUUID()}/${fileName}`;
        const destination = path.join(root, artifactId);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, bytes, { flag: 'wx', signal: context.abortSignal });
        artifacts.push(describe(artifactId, bytes.length));
      }
      return { ...result, artifacts };
    },
    async readFile(input, context) {
      context.abortSignal?.throwIfAborted();
      const { file, size } = await resolve(input.artifactId);
      const artifact = describe(input.artifactId, size);
      const text = /^(text\/|application\/(json|xml))/.test(artifact.mediaType) || artifact.mediaType === 'image/svg+xml';
      const encoding = input.encoding || (text ? 'utf8' : 'base64');
      const offset = Math.min(input.offset || 0, size);
      const length = Math.min(input.limit || 8192, size - offset);
      const handle = await open(file, 'r');
      try {
        const buffer = Buffer.alloc(Math.min(length + (encoding === 'utf8' ? 3 : 0), size - offset));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        let end = Math.min(length, bytesRead);
        // Leave an incomplete trailing UTF-8 sequence for the next page.
        if (encoding === 'utf8' && offset + end < size) {
          let start = end - 1;
          while (start >= 0 && (buffer[start] & 0xc0) === 0x80) start--;
          if (start >= 0) {
            const byte = buffer[start];
            const width = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
            if (end - start < width) end = start > 0 ? start : Math.min(width, bytesRead);
          }
        }
        return { ...artifact, encoding, content: buffer.subarray(0, end).toString(encoding), offset,
          totalBytes: size, nextOffset: offset + end < size ? offset + end : undefined,
          imagePath: /^image\/(png|jpeg|webp|gif)$/.test(artifact.mediaType) ? file : undefined };
      } finally { await handle.close(); }
    },
  };
}

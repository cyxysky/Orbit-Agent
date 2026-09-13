import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { artifactContentType } from '../dist/file/formats.js';
import { decodeFile, relativeFile, MAX_TOTAL_BYTES } from '../runtime/execution/files.cjs';

const MAX_FILES = 16;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

// The local executor deletes its temporary jobs. Persist its file transport before
// returning MCP results, and support reading/remounting artifacts across calls.
export function withLocalCodeArtifacts(executor, root) {
  async function resolve(artifactId) {
    relativeFile(artifactId);
    const file = await realpath(path.join(root, artifactId));
    const relative = path.relative(await realpath(root), file);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Invalid code artifact path.');
    }
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error('Invalid or oversized code artifact.');
    return { file, size: info.size };
  }
  const describe = (artifactId, size) => ({ artifactId, size, fileName: path.posix.basename(artifactId),
    mediaType: artifactContentType(artifactId), url: pathToFileURL(path.join(root, artifactId)).href,
    downloadUrl: pathToFileURL(path.join(root, artifactId)).href });
  return {
    health: executor.health?.bind(executor), dispose: executor.dispose?.bind(executor),
    async run(execution, context) {
      const inputFiles = [];
      let inputBytes = 0;
      for (const input of execution.artifactInputs || []) {
        relativeFile(input.path);
        if (!input.path.startsWith('inputs/')) throw new Error('Mount saved artifacts under inputs/.');
        const { file, size } = await resolve(input.artifactId);
        inputBytes += size;
        if (inputBytes > MAX_TOTAL_BYTES) throw new Error('Code inputs exceed the total byte limit.');
        inputFiles.push({ path: input.path, base64: (await readFile(file, { signal: context.abortSignal })).toString('base64') });
      }
      const { artifactInputs, ...transport } = execution;
      const { files = [], ...result } = await executor.run({ ...transport, inputFiles }, context);
      if (files.length > MAX_FILES) throw new Error('Code output exceeds the file count limit.');
      let outputBytes = 0;
      const decoded = files.map(file => {
        relativeFile(file.path);
        const bytes = decodeFile(file);
        outputBytes += bytes.length;
        if (outputBytes > MAX_TOTAL_BYTES) throw new Error('Code outputs exceed the total byte limit.');
        return { file, bytes };
      });
      const artifacts = [];
      for (const { file, bytes } of decoded) {
        const filename = path.posix.basename(file.path).replace(/[<>:"|?*\x00-\x1f]/g, '_');
        const artifactId = `${randomUUID()}/${filename}`;
        const target = path.join(root, artifactId);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, bytes, { flag: 'wx', signal: context.abortSignal });
        artifacts.push(describe(artifactId, bytes.length));
      }
      return { ...result, artifacts };
    },
    async readFile(input, context) {
      context.abortSignal?.throwIfAborted();
      const { file, size } = await resolve(input.artifactId);
      const artifact = describe(input.artifactId, size);
      const encoding = input.encoding || (/^(text\/|application\/(json|xml))/.test(artifact.mediaType) ? 'utf8' : 'base64');
      const offset = Math.min(input.offset || 0, size);
      const length = Math.min(input.limit || 8192, size - offset);
      const handle = await open(file, 'r');
      try {
        const buffer = Buffer.alloc(Math.min(length + (encoding === 'utf8' ? 3 : 0), size - offset));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        let end = Math.min(length, bytesRead);
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
          totalBytes: size, nextOffset: offset + end < size ? offset + end : undefined };
      } finally { await handle.close(); }
    },
  };
}

import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';

/** Resolve only images produced beneath this host's artifact directory. */
export function createLocalImageResolver(stateDirectory) {
  return async content => {
    const root = await realpath(path.join(stateDirectory, 'artifacts'));
    const filename = await realpath(content.artifactId);
    const relative = path.relative(root, filename);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Image artifact is outside this capability host.');
    }
    const info = await stat(filename);
    if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error('Image artifact exceeds the 32 MiB limit or is not a file.');
    return { data: (await readFile(filename)).toString('base64'), mimeType: content.mediaType || 'image/png' };
  };
}

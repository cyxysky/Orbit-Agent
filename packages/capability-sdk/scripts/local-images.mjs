import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import sharp from 'sharp';

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
    // Decode the pixels instead of trusting a filename or caller-supplied MIME.
    // Preserve pixel dimensions: desktop inputs use this exact screenshot grid.
    const pixels = await sharp(filename, { limitInputPixels: 40_000_000, animated: false }).png().toBuffer();
    if (pixels.length > 32 * 1024 * 1024) throw new Error('Decoded image exceeds the 32 MiB limit.');
    return { data: pixels.toString('base64'), mimeType: 'image/png' };
  };
}

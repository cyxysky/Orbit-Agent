import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

/** Resolve native programs and npm's Node command shims without invoking a shell. */
export function resolveNodeExecutable(command: string): string | undefined {
  const explicit = path.isAbsolute(command) || /[\\/]/.test(command);
  const extensions = process.platform === 'win32' && !path.extname(command)
    ? ['', ...(process.env.PATHEXT || '.COM;.EXE;.CMD;.BAT').split(';').map(value => value.toLowerCase()), '.js', '.mjs', '.cjs']
    : [''];
  const directories = explicit ? [''] : (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const directory of directories) {
    for (const extension of extensions) {
      const file = explicit ? path.resolve(command + extension) : path.join(directory.replace(/^"|"$/g, ''), command + extension);
      try {
        if (!statSync(file).isFile()) continue;
        if (process.platform === 'win32' && /\.cmd$/i.test(file)) {
          // npm's cmd shim is not directly executable by child_process.spawn.
          // Resolve only its quoted Node entry, preserving arguments as argv.
          const match = /(?:%dp0%|%~dp0)[\\/]([^"\r\n]+\.[cm]?js)"/i.exec(readFileSync(file, 'utf8'));
          if (!match) continue;
          const entry = path.resolve(path.dirname(file), match[1]);
          if (existsSync(entry) && statSync(entry).isFile()) return realpathSync(entry);
          continue;
        }
        if (process.platform === 'win32' && !/\.(?:exe|com|[cm]?js)$/i.test(file)) continue;
        return realpathSync(file);
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR', 'EACCES'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
      }
    }
  }
  return undefined;
}

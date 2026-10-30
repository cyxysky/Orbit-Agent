import { existsSync } from 'node:fs';
import path from 'node:path';

export function resolveCodexCliPath(configuredPath: string | undefined, projectRoot: string) {
  const value = String(configuredPath || '').trim();
  if (value) {
    const expandedPath = value.replace(/^\[project\](?=$|[\\/])/i, projectRoot);
    if (expandedPath !== value || path.isAbsolute(expandedPath)) {
      return path.normalize(expandedPath);
    }
    if (expandedPath.startsWith('.') || /[\\/]/.test(expandedPath)) {
      return path.resolve(projectRoot, expandedPath);
    }
    return expandedPath;
  }

  // Next.js can rewrite createRequire(import.meta.url).resolve() inside the
  // provider to a literal "[project]" path. Supplying the optional local CLI
  // entry explicitly bypasses that bundled resolver while retaining the PATH
  // fallback when the optional dependency is not installed.
  const localCliPath = path.join(
    projectRoot,
    'node_modules',
    '@openai',
    'codex',
    'bin',
    'codex.js',
  );
  return existsSync(localCliPath) ? localCliPath : undefined;
}

import path from 'node:path';
import { resolveNodeExecutable } from '@/server/node-executable';

export function resolveCodexCliPath(configuredPath: string | undefined, projectRoot: string) {
  const value = String(configuredPath || '').trim();
  if (value) {
    const expandedPath = value.replace(/^\[project\](?=$|[\\/])/i, projectRoot);
    if (expandedPath !== value || path.isAbsolute(expandedPath)) {
      return resolveNodeExecutable(expandedPath) || path.normalize(expandedPath);
    }
    if (expandedPath.startsWith('.') || /[\\/]/.test(expandedPath)) {
      const absolutePath = path.resolve(projectRoot, expandedPath);
      return resolveNodeExecutable(absolutePath) || absolutePath;
    }
    return resolveNodeExecutable(expandedPath) || expandedPath;
  }

  // The CLI is installed externally. Resolve PATH directly, including npm's
  // Windows shims; the provider may use npx only when explicitly enabled.
  return resolveNodeExecutable('codex');
}

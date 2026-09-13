import path from 'node:path';
import { readManagedRuntime, runtimeDirectory, managedModelDirectory } from '../runtime/managed/layout.cjs';
export { readManagedRuntime, runtimeDirectory, managedModelDirectory };
export type { ManagedRuntime } from '../runtime/managed/layout.cjs';

/** Explicit host settings take precedence over installed runtime defaults. */
export function managedChromiumOptions() {
  const executablePath = readManagedRuntime()?.chromium;
  return executablePath ? { executablePath } : {};
}

/** Adds the installed executables to child processes without modifying process.env. */
export function managedProcessEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const runtime = readManagedRuntime(environment);
  if (!runtime) return environment;
  const result = { ...environment };
  const pathKey = process.platform === 'win32' ? Object.keys(environment).find(key => key.toLowerCase() === 'path') : 'PATH';
  const originalPath = pathKey ? environment[pathKey] || '' : '';
  if (process.platform === 'win32') for (const key of Object.keys(result)) if (key.toLowerCase() === 'path') delete result[key];
  result.PATH = [...new Set([runtime.python, runtime.ffmpeg, runtime.libreoffice].filter(Boolean).map(executable => path.dirname(executable))), originalPath].join(path.delimiter);
  return result;
}

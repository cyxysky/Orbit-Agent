import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import source from './backend-source.cjs';

const root = process.env.WEBPILOT_APP_DIR || process.cwd();
const options = source.backendCompilerOptions(root, ts);
const resolveSource = source.sourceResolver(root, options.paths || {});

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next' || specifier.startsWith('next/') || specifier === '@next/env') {
    throw new Error(`Next is not allowed in the Node backend: ${specifier}`);
  }
  const parent = context.parentURL?.startsWith('file:') ? fileURLToPath(context.parentURL) : path.join(root, 'package.json');
  const resolved = resolveSource(specifier, parent);
  if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (/\.[cm]?tsx?$/.test(url) && url.startsWith('file:')) {
    const filename = fileURLToPath(url);
    const result = ts.transpileModule(await fs.readFile(filename, 'utf8'), { compilerOptions: options, fileName: filename });
    return { format: 'module', source: result.outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}

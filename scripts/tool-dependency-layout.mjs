import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { packageTool } = require('../packages/capability-sdk/runtime/managed/package-tool.cjs');
const catalog = require('../packages/capability-sdk/runtime/managed/tools.json').tools;

export async function toolDependencyLayout(root) {
  const workspace = path.join(root, 'packages', 'capability-sdk');
  const sdkRoot = fs.existsSync(path.join(workspace, 'package.json')) ? workspace : fs.realpathSync(path.join(root, 'node_modules', '@cjfclonedeep', 'capability-sdk'));
  const staging = path.join(root, '.tmp', 'tool-dependency-layout');
  const components = {};
  for (const tool of catalog) {
    const result = await packageTool({ sdkRoot, output: path.join(staging, tool.id), tool });
    if (Object.hasOwn(result.dependencies, '@cjfclonedeep/capability-sdk')) throw new Error('A tool cannot install the complete SDK as its dependency.');
    components[tool.id] = Object.keys(result.dependencies);
  }
  const core = new Set(['@modelcontextprotocol/server', '@ai-sdk/mcp', 'ai', 'ai-sdk-provider-codex-cli', 'react', 'react-dom', 'zod', 'sharp', 'ws', 'acorn', 'postcss', 'typescript', 'undici', 'cross-spawn']);
  const optional = [...new Set(Object.values(components).flat())].filter(name => !core.has(name) && !name.startsWith('@ai-sdk/'));
  return { version: 1, components, optional };
}

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { CodedError, ERROR_CODES } from '../errors.ts';

const ownRequire = createRequire(import.meta.url);
const instances = new Map<string, unknown>();
function packageName(specifier: string) { return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]; }
export function resolveToolModule(specifier: string): string {
  // A tool's own package resolves locally. The Orbit shell resolves from installed components.
  try { return ownRequire.resolve(specifier); } catch { /* component lookup */ }
  const directory = path.resolve(process.env.CAPABILITY_TOOLS_HOME || path.join(process.env.APP_DATA_DIR || path.join(process.cwd(), 'runtime'), 'tool-components'));
  const catalog = JSON.parse(readFileSync(new URL('../../runtime/managed/tools.json', import.meta.url), 'utf8')) as { tools: Array<{ id: string }> };
  const name = packageName(specifier);
  for (const tool of catalog.tools) {
    let state: { state: string; release?: string };
    try { state = JSON.parse(readFileSync(path.join(directory, '.state', tool.id + '.json'), 'utf8')); } catch { continue; }
    if (state.state !== 'ready' || !state.release) continue;
    const release = path.resolve(state.release);
    if (!release.startsWith(path.join(directory, 'packages', tool.id) + path.sep)) continue;
    try {
      const component = JSON.parse(readFileSync(path.join(release, 'component.json'), 'utf8'));
      if (!Object.hasOwn(component.dependencies || {}, name)) continue;
      return createRequire(path.join(release, 'package.json')).resolve(specifier);
    } catch { /* another installed component may provide this dependency */ }
  }
  throw new CodedError(ERROR_CODES.CAPABILITY_EXECUTION_FAILED, `工具依赖 ${name} 尚未安装。请在设置 → 工具组件中安装对应工具。`);
}
export function requireToolModule<T = unknown>(specifier: string): T {
  const filename = resolveToolModule(specifier);
  if (!instances.has(filename)) instances.set(filename, ownRequire(filename));
  return instances.get(filename) as T;
}
export function importToolModule(specifier: string) { return import(pathToFileURL(resolveToolModule(specifier)).href); }
export function lazyToolExport<T = unknown>(specifier: string, name?: string): T {
  const value = () => {
    const module = requireToolModule<Record<PropertyKey, unknown>>(specifier);
    return name === undefined ? module : name === 'default' ? module.default ?? module : module[name];
  };
  return new Proxy(function () {}, {
    get(_target, key) {
      if (key === Symbol.toPrimitive) return () => value();
      const current = value();
      const member = Reflect.get(Object(current), key);
      return typeof member === 'function' ? member.bind(current) : member;
    },
    apply(_target, receiver, args) { return Reflect.apply(value() as (...args: unknown[]) => unknown, receiver, args); },
    construct(_target, args) { return Reflect.construct(value() as new (...args: unknown[]) => object, args); },
  }) as T;
}

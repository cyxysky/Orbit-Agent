import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { getQuickJS, type QuickJSHandle } from 'quickjs-emscripten';

// Only JSON crosses this worker boundary. Extension code runs in QuickJS/WASM,
// not in Node's VM or the worker's own JavaScript realm.
type Request = {
  source: string; id: string; mode: 'inspect' | 'invoke'; tool?: string; input?: unknown;
  storageRoot: string; projectRoot?: string; deniedPaths: string[]; permissions: string[];
  userId?: string; sessionId?: string; memoryBytes: number; timeoutMs: number;
};
const request = workerData as Request;
const maxFileBytes = 256_000;
let calls = 0;

function resolveFile(root: string, relative: unknown, allowMissing = false) {
  if (typeof relative !== 'string' || relative.length > 512 || path.isAbsolute(relative)
    || /^[\\/]|^[a-z]:|[\u0000-\u001f]/i.test(relative)) throw new Error('Expected a relative workspace path.');
  const parts = relative.replace(/\\/g, '/').split('/').filter(part => part && part !== '.');
  if (parts.some(part => part === '..' || /[<>:"|?*]/.test(part) || /[ .]$/.test(part)
    || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) {
    throw new Error('Workspace traversal and non-portable path aliases are denied.');
  }
  const canonicalRoot = fs.realpathSync.native(root);
  let result = canonicalRoot;
  for (const part of parts) {
    result = path.join(result, part);
    try {
      if (fs.lstatSync(result).isSymbolicLink()) throw new Error('Workspace symbolic links and junctions are denied.');
      result = fs.realpathSync.native(result);
    }
    catch (error) { if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const inside = path.relative(canonicalRoot, result);
  if (inside.startsWith('..') || path.isAbsolute(inside)) throw new Error('Path is outside the workspace.');
  return result;
}

function protectedProjectPath(relative: string) {
  const parts = relative.replace(/\\/g, '/').split('/').filter(part => part && part !== '.');
  const lower = parts.join('/').toLowerCase();
  return parts.some(part => part.startsWith('.')) || request.deniedPaths.some(item =>
    item.includes('/') ? lower === item || lower.startsWith(`${item}/`) : parts.some(part => part.toLowerCase() === item));
}

function hostCall(operation: string, args: unknown[]) {
  if (request.mode !== 'invoke') throw new Error('Module initialization cannot access host data.');
  if (!['storage.get', 'storage.set', 'storage.remove', 'project.readText', 'project.list'].includes(operation)) throw new Error('Unknown extension host operation.');
  if (++calls > 100) throw new Error('Extension host operation limit exceeded.');
  const permission = operation === 'storage.set' || operation === 'storage.remove' ? 'storage:write'
    : operation.startsWith('storage.') ? 'storage:read' : 'project:read';
  if (!request.permissions.includes(permission)) throw new Error(`Missing declared permission: ${permission}`);
  if (operation.startsWith('storage.')) {
    const key = args[0];
    if (typeof key !== 'string' || !key.length || key.length > 120) throw new Error('Invalid storage key.');
    const file = resolveFile(request.storageRoot, `${Buffer.from(key).toString('hex')}.json`, true);
    if (operation === 'storage.get') {
      if (!fs.existsSync(file)) return null;
      if (fs.statSync(file).size > maxFileBytes) throw new Error('Storage value exceeds its size limit.');
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    if (operation === 'storage.remove') { fs.rmSync(file, { force: true }); return null; }
    const text = JSON.stringify(args[1]);
    if (text === undefined || Buffer.byteLength(text) > maxFileBytes) throw new Error('Storage value exceeds its size limit.');
    const temporary = `${file}.${randomUUID()}.partial`;
    try { fs.writeFileSync(temporary, text, { flag: 'wx' }); fs.renameSync(temporary, file); }
    finally { fs.rmSync(temporary, { force: true }); }
    return null;
  }
  if (!request.projectRoot) throw new Error('Project access is unavailable.');
  const relative = typeof args[0] === 'string' ? args[0].replace(/\\/g, '/') : '';
  const normalized = relative.split('/').filter(part => part !== '.').join('/');
  if (protectedProjectPath(normalized)) {
    throw new Error('This project path is protected.');
  }
  const file = resolveFile(request.projectRoot, relative);
  if (protectedProjectPath(path.relative(fs.realpathSync.native(request.projectRoot), file))) throw new Error('This project path is protected.');
  if (operation === 'project.list') return fs.readdirSync(file, { withFileTypes: true })
    .filter(entry => !entry.isSymbolicLink() && !protectedProjectPath(`${normalized ? `${normalized}/` : ''}${entry.name}`))
    .slice(0, 200).map(entry => ({ name: entry.name, directory: entry.isDirectory() }));
  if (operation !== 'project.readText') throw new Error('Unknown extension host operation.');
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > maxFileBytes) throw new Error('Project file is not a bounded text file.');
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes('\0')) throw new Error('Binary files cannot be read as text.');
  return text;
}

async function main() {
  const compiled = ts.transpileModule(request.source, { fileName: 'extension.ts', reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, isolatedModules: true } });
  const diagnostics = compiled.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error) || [];
  if (diagnostics.length) throw new Error(diagnostics.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')).join('\n'));
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(request.memoryBytes);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + request.timeoutMs;
  runtime.setInterruptHandler(() => Date.now() > deadline);
  runtime.setModuleLoader(name => { throw new Error(`Extension imports are unavailable: ${name}`); });
  const vm = runtime.newContext();
  const unwrap = (result: ReturnType<typeof vm.evalCode>): QuickJSHandle => {
    if (result.error) { const detail = vm.dump(result.error); result.error.dispose(); throw new Error(detail?.message || String(detail)); }
    return result.value;
  };
  const settle = (handle: QuickJSHandle) => {
    for (;;) {
      const state = vm.getPromiseState(handle);
      if (state.type === 'fulfilled') return state.notAPromise ? state.value.dup() : state.value;
      if (state.type === 'rejected') { const detail = vm.dump(state.error); state.error.dispose(); throw new Error(detail?.message || String(detail)); }
      const jobs = runtime.executePendingJobs(100);
      if (jobs.error) { const detail = vm.dump(jobs.error); jobs.error.dispose(); throw new Error(detail?.message || String(detail)); }
      const count = jobs.value;
      if (!count || Date.now() > deadline) throw new Error('Extension promise did not settle within its execution budget.');
    }
  };
  const evaluate = (code: string) => { const result = unwrap(vm.evalCode(code)); try { const settled = settle(result); try { return vm.dump(settled); } finally { settled.dispose(); } } finally { result.dispose(); } };
  try {
    const bridge = vm.newFunction('__hostCall', (operation, argumentsJson) => {
      try { return vm.newString(JSON.stringify({ ok: true, data: hostCall(vm.getString(operation), JSON.parse(vm.getString(argumentsJson))) })); }
      catch (error) { return vm.newString(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) })); }
    });
    vm.setProp(vm.global, '__hostCall', bridge); bridge.dispose();
    evaluate(`globalThis.__tools=new Map();globalThis.__hooks={load:[],beforeInvoke:[],afterInvoke:[],unload:[]};
      globalThis.__api=Object.freeze({registerTool(tool){if(!tool||typeof tool.execute!=="function"||__tools.has(tool.name))throw Error("Invalid or duplicate extension tool");__tools.set(tool.name,tool)},on(event,handler){if(!__hooks[event]||typeof handler!=="function")throw Error("Invalid lifecycle hook");__hooks[event].push(handler)}});
      globalThis.__call=(operation,...args)=>{const result=JSON.parse(__hostCall(operation,JSON.stringify(args)));if(!result.ok)throw Error(result.message);return result.data};
      globalThis.__ctx=Object.freeze({userId:${JSON.stringify(request.userId || '')},sessionId:${JSON.stringify(request.sessionId || '')},storage:Object.freeze({get:key=>__call("storage.get",key),set:(key,value)=>__call("storage.set",key,value),remove:key=>__call("storage.remove",key)}),project:Object.freeze({readText:path=>__call("project.readText",path),list:(path="")=>__call("project.list",path)})});`);
    const module = unwrap(vm.evalCode(compiled.outputText, 'extension.mjs', { type: 'module' }));
    let namespace: QuickJSHandle | undefined;
    try {
      namespace = settle(module);
      const manifest = vm.getProp(namespace, 'manifest');
      let manifestValue: unknown;
      try { manifestValue = vm.dump(manifest); } finally { manifest.dispose(); }
      const factory = vm.getProp(namespace, 'default');
      const api = vm.getProp(vm.global, '__api');
      try { const result = unwrap(vm.callFunction(factory, vm.undefined, api)); try { settle(result).dispose(); } finally { result.dispose(); } }
      finally { factory.dispose(); api.dispose(); }
      const metadata = { manifest: manifestValue,
        tools: JSON.parse(String(evaluate('JSON.stringify([...__tools.values()].map(({execute,...tool})=>tool))'))),
        hooks: JSON.parse(String(evaluate('JSON.stringify(Object.keys(__hooks).filter(key=>__hooks[key].length))'))) };
      if (request.mode === 'inspect') return { metadata };
      const toolName = JSON.stringify(request.tool), input = JSON.stringify(request.input ?? null);
      const output = evaluate(`(async()=>{try{for(const hook of __hooks.load)await hook(__ctx);for(const hook of __hooks.beforeInvoke)await hook({tool:${toolName},input:${input}},__ctx);const tool=__tools.get(${toolName});if(!tool)throw Error("Unknown extension tool");const result=await tool.execute(${input},__ctx);for(const hook of __hooks.afterInvoke)await hook({tool:${toolName},result},__ctx);return JSON.stringify(result??null)}finally{for(const hook of __hooks.unload)await hook(__ctx)}})()`);
      if (typeof output !== 'string' || Buffer.byteLength(output) > 512_000) throw new Error('Extension result exceeds its output budget.');
      return { metadata, output: JSON.parse(output) };
    } finally { namespace?.dispose(); module.dispose(); }
  } finally { vm.dispose(); runtime.dispose(); }
}

main().then(value => parentPort!.postMessage({ ok: true, value }), error => parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }));

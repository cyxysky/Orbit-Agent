const fs = require('node:fs');
const path = require('node:path');
const { builtinModules, createRequire, stripTypeScriptTypes } = require('node:module');
const { pathToFileURL } = require('node:url');

const builtins = new Set(builtinModules.flatMap(name => [name, 'node:' + name]));
const inside = (root, file) => file === root || file.startsWith(root + path.sep);
const packageName = name => name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];

/** Create one installable MCP tool. Dependencies are collected from its actual module graph. */
async function packageTool({ sdkRoot, output, tool }) {
  sdkRoot = fs.realpathSync(sdkRoot);
  output = path.resolve(output);
  if (inside(sdkRoot, output)) throw new Error('Tool staging must be outside the SDK source tree.');
  const manifest = JSON.parse(fs.readFileSync(path.join(sdkRoot, 'package.json'), 'utf8'));
  const sdkRequire = createRequire(path.join(sdkRoot, 'package.json'));
  const { parse } = sdkRequire('acorn');
  const files = new Set(), dependencies = new Map();
  const optionalAssets = require('./tools.json').optionalAssets || [];
  function included(filename) {
    const relative = path.relative(sdkRoot, filename).split(path.sep).join('/');
    return !optionalAssets.some(asset => (relative === asset.path || relative.startsWith(asset.path + '/')) && !tool[asset.flag]);
  }
  const sdkOutput = path.join(output, 'sdk');
  fs.mkdirSync(sdkOutput, { recursive: true });

  function dependency(specifier) {
    const name = packageName(specifier);
    if (builtins.has(specifier) || specifier.startsWith('node:')) return;
    if (dependencies.has(name)) return;
    const replacement = require('./tools.json').dependencyOverrides?.[name];
    if (replacement) { dependencies.set(name, replacement); return; }
    let version;
    try {
      let directory = path.dirname(sdkRequire.resolve(specifier));
      for (;;) {
        const filename = path.join(directory, 'package.json');
        if (fs.existsSync(filename)) {
          const candidate = JSON.parse(fs.readFileSync(filename, 'utf8'));
          if (candidate.name === name) { version = candidate.version; break; }
        }
        const parent = path.dirname(directory);
        if (parent === directory) break;
        directory = parent;
      }
    } catch { /* Published SDK packages carry declared dependency ranges. */ }
    version ||= manifest.dependencies?.[name] || manifest.peerDependencies?.[name];
    if (!version) throw new Error('Undeclared tool dependency: ' + name);
    dependencies.set(name, version);
  }

  function sourceFile(filename) {
    const candidates = [filename, filename.replace(/\.js$/, '.ts'), filename + '.js', filename + '.ts', path.join(filename, 'index.js'), path.join(filename, 'index.ts')];
    if (filename.includes(path.sep + 'dist' + path.sep)) {
      const source = filename.replace(path.sep + 'dist' + path.sep, path.sep + 'src' + path.sep);
      candidates.push(source.replace(/\.js$/, '.ts'), source.replace(/\.js$/, '.tsx'), source);
    }
    // A workspace source checkout is authoritative; dist/ may be from an older release.
    const ordered = fs.existsSync(path.join(sdkRoot, 'src', 'index.ts'))
      ? [...candidates.filter(p => p.includes(path.sep + 'src' + path.sep)), ...candidates] : candidates;
    return ordered.find(p => fs.existsSync(p) && fs.statSync(p).isFile());
  }
  function destination(filename) {
    const relative = path.relative(sdkRoot, filename).replace(/^src[\\/]/, 'dist/').replace(/\.[cm]?tsx?$/, '.js');
    const target = path.resolve(sdkOutput, relative);
    if (!inside(sdkOutput, target)) throw new Error('Tool module escapes its SDK package.');
    return target;
  }
  function asset(source, target = destination(source), scan = false) {
    if (!included(source)) return;
    if (!inside(sdkRoot, source) || !inside(sdkOutput, target)) throw new Error('Tool asset escapes its package.');
    if (!fs.existsSync(source)) return;
    const info = fs.lstatSync(source);
    if (info.isSymbolicLink()) throw new Error('Tool source assets must not be symbolic links.');
    if (info.isDirectory()) {
      for (const entry of fs.readdirSync(source)) asset(path.join(source, entry), path.join(target, entry), scan);
    } else if (scan && /\.[cm]?js$/.test(source)) {
      visit(source);
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
  }
  function visit(filename, supplied) {
    filename = path.resolve(filename);
    if (!included(filename)) return;
    if (!inside(sdkRoot, filename)) throw new Error('Tool source module is outside its SDK.');
    if (files.has(filename)) return;
    files.add(filename);
    let code = supplied ?? fs.readFileSync(filename, 'utf8');
    if (/\.tsx$/.test(filename)) {
      const ts = sdkRequire('typescript');
      code = ts.transpileModule(code, { fileName: filename, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    } else if (/\.[cm]?ts$/.test(filename)) code = stripTypeScriptTypes(code, { mode: 'transform', sourceUrl: pathToFileURL(filename).href });
    if (!/\.[cm]?[jt]sx?$/.test(filename)) { asset(filename); return; }
    const edits = [];
    const ast = parse(code, { ecmaVersion: 'latest', sourceType: /\.cjs$/.test(filename) ? 'script' : 'module', allowHashBang: true });
    function follow(node) {
      let literal;
      if ((node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source) literal = node.source;
      if (node.type === 'ImportExpression') literal = node.source;
      if (node.type === 'CallExpression' && (node.callee?.name === 'require' ||
        node.callee?.property?.name === 'resolve' && (/require/i.test(node.callee.object?.name || '') || node.callee.object?.callee?.name === 'createRequire'))) literal = node.arguments[0];
      if (literal?.type === 'Literal' && typeof literal.value === 'string') {
        const name = literal.value;
        if (name.startsWith('.') || name === manifest.name || name.startsWith(manifest.name + '/')) {
          let requested;
          if (name.startsWith('.')) requested = path.resolve(path.dirname(filename), name);
          else {
            const key = name === manifest.name ? '.' : '.' + name.slice(manifest.name.length);
            let exported = manifest.exports[key];
            if (exported && typeof exported === 'object') exported = exported.import || exported.default;
            if (typeof exported !== 'string') throw new Error('Unknown SDK self export: ' + name);
            requested = path.resolve(sdkRoot, exported);
          }
          const source = sourceFile(requested);
          if (source) {
            visit(source);
            let relative = path.relative(path.dirname(destination(filename)), destination(source)).split(path.sep).join('/');
            if (!relative.startsWith('.')) relative = './' + relative;
            edits.push({ start: literal.start, end: literal.end, text: JSON.stringify(relative) });
          } else if (!name.endsWith('.css')) throw new Error('Unresolved tool module: ' + filename + ' -> ' + name);
        } else if (!name.startsWith('#')) dependency(name);
      }
      // Worker files and binary/template resources retain their relative placement.
      if (node.type === 'NewExpression' && node.callee?.name === 'URL' && node.arguments?.[0]?.type === 'Literal' && typeof node.arguments[0].value === 'string' && node.arguments[0].value.startsWith('.')) {
        const name = node.arguments[0].value;
        const source = sourceFile(path.resolve(path.dirname(filename), name));
        if (source && /\.[cm]?[jt]sx?$/.test(source)) {
          visit(source);
          let relative = path.relative(path.dirname(destination(filename)), destination(source)).split(path.sep).join('/');
          if (!relative.startsWith('.')) relative = './' + relative;
          edits.push({ start: node.arguments[0].start, end: node.arguments[0].end, text: JSON.stringify(relative) });
        } else if (source) asset(source);
      }
      for (const [key, value] of Object.entries(node)) {
        if (key === 'parent') continue;
        if (Array.isArray(value)) { for (const child of value) if (child?.type) follow(child); }
        else if (value?.type) follow(value);
      }
    }
    follow(ast);
    for (const edit of edits.sort((a, b) => b.start - a.start)) code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
    const target = destination(filename);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, code.replace(/^\/\/# sourceMappingURL=.*$/gm, ''));
  }

  const providerFile = path.join(sdkRoot, 'scripts', 'mcp-providers.mjs');
  const providerSource = fs.readFileSync(providerFile, 'utf8');
  const tree = parse(providerSource, { ecmaVersion: 'latest', sourceType: 'module' });
  let factory;
  function find(node) {
    if (node.type === 'Property' && (node.key.name || node.key.value) === tool.group && node.value?.type === 'FunctionExpression') factory = node.value;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) { for (const child of value) if (child?.type) find(child); }
      else if (value?.type) find(value);
    }
  }
  find(tree);
  if (!factory) throw new Error('SDK does not provide tool group: ' + tool.group);
  const imports = tree.body.filter(node => node.type === 'ImportDeclaration').map(node => providerSource.slice(node.start, node.end)).join('\n');
  const body = providerSource.slice(factory.body.start + 1, factory.body.end - 1);
  const selected = `${imports}\nexport const localToolGroups=${JSON.stringify([tool.group])};\nexport function defaultToolGroups(){return localToolGroups;}\nexport async function createLocalProviders({projectRoot,stateDirectory,groups,config={},onMapView}){\nif(groups.some(id=>!localToolGroups.includes(id)))throw new Error('This component contains one tool only.');\nconst artifactsRoot=path.resolve(process.env.CAPABILITY_ARTIFACTS_DIR||path.join(stateDirectory,'artifacts'));\nasync function create(){${body}}\nreturn groups.length?[await create()]:[];\n}\n`;
  visit(providerFile, selected);
  const entry = `import path from 'node:path';
import {readFile,mkdir} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {createLocalProviders} from './mcp-providers.mjs';
import {loadConfig,toolConfiguration} from './mcp-config.mjs';
import {createCapabilityMcpServer} from '../dist/adapters/mcp/index.js';
import {EnvironmentCapabilityConfigStore} from '../dist/host/index.js';
import {serveStdio} from '@modelcontextprotocol/server/stdio';
${tool.images ? "import {createLocalImageResolver} from './local-images.mjs';" : ''}
const {values}=parseArgs({options:{project:{type:'string'},config:{type:'string'},tools:{type:'string'}}});
if(values.tools&&values.tools!==${JSON.stringify(tool.group)})throw new Error('This package contains one tool.');
const projectRoot=path.resolve(values.project||process.env.CAPABILITY_PROJECT_DIR||process.cwd());
await mkdir(projectRoot,{recursive:true});process.chdir(projectRoot);
const stateDirectory=path.resolve(process.env.CAPABILITY_STATE_DIR||path.join(projectRoot,'.capability-state'));
await mkdir(stateDirectory,{recursive:true});
const loaded=await loadConfig(projectRoot,values.config||process.env.CAPABILITY_TOOL_CONFIG_FILE);
const config=loaded.value;const group=${JSON.stringify(tool.group)};
const context=process.env.CAPABILITY_TOOL_CONTEXT_FILE?JSON.parse(await readFile(process.env.CAPABILITY_TOOL_CONTEXT_FILE,'utf8')):{};
const providers=await createLocalProviders({projectRoot,stateDirectory,groups:[group],config});
const handle=serveStdio(()=>createCapabilityMcpServer({providers,name:'capability-'+group,version:${JSON.stringify(manifest.version)},
visualization:{enabled:${Boolean(tool.visualization)} && process.env.CAPABILITY_MCP_VISUALIZATION!=='false'},${tool.images ? 'resolveImage:createLocalImageResolver(stateDirectory),' : ''}
configStore:new EnvironmentCapabilityConfigStore(process.env),
context:()=>({...context,configuration:{AGENT_TERMINAL_ENABLED:process.env.AGENT_TERMINAL_ENABLED??'true',AGENT_CODE_SANDBOX_ENABLED:process.env.AGENT_CODE_SANDBOX_ENABLED??'true',AGENT_CODE_SANDBOX_BACKEND:process.env.AGENT_CODE_SANDBOX_BACKEND??'local',AGENT_COMPUTER_ENABLED:process.env.AGENT_COMPUTER_ENABLED??'true',...context.configuration}}),
configurations:Object.fromEntries(providers.map(provider=>[provider.manifest.id,toolConfiguration(config,group,projectRoot)]))}));
let stopping;const stop=()=>stopping||=(async()=>{const timeout=setTimeout(()=>process.exit(1),10000);timeout.unref();try{await handle.close();${tool.dispose ? `await (await import('../dist/${tool.dispose.module}'))[${JSON.stringify(tool.dispose.export)}]();` : ''}process.exit(0);}catch(error){console.error(error);process.exit(1);}})();
process.once('SIGTERM',stop);process.once('SIGINT',stop);process.stdin.once('end',stop);
`;
  visit(path.join(sdkRoot, 'scripts', 'tool-entry.mjs'), entry);
  // Shared runtime installers are assets, not dependencies of every tool.
  for (const name of ['managed', 'sensitive-data']) asset(path.join(sdkRoot, 'runtime', name));
  for (const name of ['runtime.cjs']) asset(path.join(sdkRoot, 'scripts', name));
  for (const name of [tool.group === 'code' ? 'execution' : tool.group]) asset(path.join(sdkRoot, 'runtime', name), undefined, true);
  if (['chart', 'maps'].includes(tool.group)) {
    asset(path.join(sdkRoot, 'runtime', 'ui'));
    visit(path.join(sdkRoot, 'scripts', 'mcp-ui.mjs'));
  }
  for (const name of ['LICENSE', 'mcp-config.schema.json']) asset(path.join(sdkRoot, name));
  if (tool.runtime) dependency('undici');
  const tailored = { name: manifest.name, version: manifest.version, type: 'module', exports: manifest.exports,
    dependencies: Object.fromEntries([...dependencies].sort(([a], [b]) => a.localeCompare(b))) };
  fs.writeFileSync(path.join(sdkOutput, 'package.json'), JSON.stringify(tailored, null, 2));
  fs.writeFileSync(path.join(output, 'package.json'), JSON.stringify({ name: 'capability-tool-' + tool.id.toLowerCase(), version: manifest.version, private: true,
    dependencies: tailored.dependencies }, null, 2));
  return { toolId: tool.id, version: manifest.version, files: files.size, dependencies: tailored.dependencies, entry: 'sdk/scripts/tool-entry.mjs', args: ['--tools', tool.group] };
}

module.exports = { packageTool };

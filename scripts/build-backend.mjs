import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import source from '../server/backend-source.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist-backend');
const checkOnly = process.argv.includes('--check');
const options = source.backendCompilerOptions(root, ts);
const resolveSource = source.sourceResolver(root, options.paths || {});
const seen = new Set();
const files = new Map();
function outputPath(file) {
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Backend source outside workspace: ${file}`);
  return path.join(output, relative.replace(/\.[cm]?tsx?$/, '.js'));
}
function visit(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const input = fs.readFileSync(file, 'utf8');
  const compiled = /\.[cm]?tsx?$/.test(file)
    ? ts.transpileModule(input, { fileName: file, compilerOptions: options, reportDiagnostics: true })
    : { outputText: input, diagnostics: [] };
  const errors = (compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(`${file}: ${errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')}`);
  let code = compiled.outputText;
  const parsed = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits = [];
  function rewrite(node) {
    let specifier;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) specifier = node.moduleSpecifier;
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(parsed) === 'require') && node.arguments.length) specifier = node.arguments[0];
    if (specifier && ts.isStringLiteral(specifier)) {
      const name = specifier.text;
      if (name === 'next' || name.startsWith('next/') || name === '@next/env') throw new Error(`Next dependency in backend graph: ${file} -> ${name}`);
      const target = resolveSource(name, file);
      if (target) {
        visit(target);
        let replacement = path.relative(path.dirname(outputPath(file)), outputPath(target)).split(path.sep).join('/');
        if (!replacement.startsWith('.')) replacement = `./${replacement}`;
        edits.push({ start: specifier.getStart(parsed), end: specifier.end, text: JSON.stringify(replacement) });
      } else if (name.startsWith('.') || name.startsWith('@/')) throw new Error(`Unresolved backend import: ${file} -> ${name}`);
    }
    ts.forEachChild(node, rewrite);
  }
  rewrite(parsed);
  for (const edit of edits.sort((a, b) => b.start - a.start)) code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
  // Rewriting specifiers changes positions; do not ship misleading source maps.
  code = code.replace(/^\/\/# sourceMappingURL=.*$/gm, '');
  files.set(outputPath(file), code);
}
visit(path.join(root, 'src/backend/http-server.ts'));
// A route accidentally omitted from the manifest must fail packaging rather
// than silently disappear from the Node API.
function checkRouteCoverage(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) checkRouteCoverage(file);
    else if (entry.name === 'route.ts' && !seen.has(file)) throw new Error(`Route missing from Node manifest: ${file}`);
  }
}
checkRouteCoverage(path.join(root, 'src/backend/routes'));
if (!checkOnly) {
  if (path.dirname(output) !== root || path.basename(output) !== 'dist-backend') throw new Error('Invalid backend output directory');
  fs.rmSync(output, { recursive: true, force: true });
  for (const [file, contents] of files) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, contents); }
  fs.writeFileSync(path.join(output, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ version: 1, entry: 'src/backend/http-server.js', files: [...files.keys()].map(file => path.relative(output, file)) }, null, 2));
}
console.log(`${checkOnly ? 'Checked' : 'Compiled'} ${files.size} Node backend modules; no Next imports.`);

import type { OfficeDocumentDraft } from '../office/types.ts';
import { runCapabilityProcess } from '../../node.ts';
import { resolveLibreOfficePythonExecutable } from './libreoffice.ts';

export const officeBodyVariables = { presentation: 'deck', word: 'document', spreadsheet: 'workbook' } as const;

/** Compose syntax only. The resulting complete source uses the ordinary validator/renderer. */
export async function compileOfficeBody(body: string, draft: OfficeDocumentDraft, signal?: AbortSignal) {
  const generator = draft.generator || 'uno';
  if (generator === 'html') {
    if (/<(?:!doctype|html|head|body)\b/i.test(body)) throw new Error('body accepts an HTML fragment; use program for a complete HTML document.');
    const style = draft.documentType === 'presentation'
      ? 'body{margin:0;font-family:Arial,sans-serif}section[data-slide]{width:1280px;height:720px;box-sizing:border-box;padding:48px}h1{font-size:48px}p,li{font-size:28px}'
      : '@page{size:A4;margin:18mm}body{font:12pt Arial,sans-serif;line-height:1.5}h1,h2{break-after:avoid}img,svg{max-width:100%}table{border-collapse:collapse}';
    return `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>\n${body}\n</body></html>`;
  }
  if (generator === 'javascript') {
    if (draft.documentType !== 'spreadsheet') throw new Error('JavaScript body mode supports ExcelJS spreadsheets only.');
    // No indentation rewrite: multiline template strings must retain their bytes.
    return `export async function createDocument(job) {\nconst workbook = new job.ExcelJS.Workbook();\n${body}\nawait workbook.xlsx.writeFile(job.outputPath);\n}\n`;
  }
  const python = await resolveLibreOfficePythonExecutable();
  if (!python) throw new Error('UNO body compilation requires the project Python runtime.');
  const script = [
    'import ast, json, sys',
    'data = json.loads(sys.stdin.buffer.read().decode("utf-8"))',
    'tree = ast.parse(data["body"], filename="body.py")',
    'if any(isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == "create_document" for n in ast.walk(tree)): raise ValueError("body must contain content operations, not create_document; use program for a complete source")',
    'name = data["variable"]',
    'factory = ast.Call(func=ast.Attribute(value=ast.Name(id="job", ctx=ast.Load()), attr=data["factory"], ctx=ast.Load()), args=[ast.Constant(value="document")], keywords=[])',
    'if data.get("sourceName"): factory.keywords.append(ast.keyword(arg="source_name", value=ast.Constant(value=data["sourceName"])))',
    'function = ast.parse("def create_document(job):\\n    pass").body[0]',
    'function.body = [ast.Assign(targets=[ast.Name(id=name, ctx=ast.Store())], value=factory)] + tree.body',
    'for method in ("save", "close"): function.body.append(ast.Expr(value=ast.Call(func=ast.Attribute(value=ast.Name(id=name, ctx=ast.Load()), attr=method, ctx=ast.Load()), args=[], keywords=[])))',
    'module = ast.fix_missing_locations(ast.Module(body=[function], type_ignores=[]))',
    'print(json.dumps(ast.unparse(module) + "\\n", ensure_ascii=True))',
  ].join('\n');
  const result = await runCapabilityProcess({ executable: python, args: ['-c', script],
    stdin: JSON.stringify({ body, variable: officeBodyVariables[draft.documentType],
      factory: { presentation: 'presentation', word: 'writer', spreadsheet: 'spreadsheet' }[draft.documentType],
      sourceName: draft.sourceDocument?.assetName }), signal, timeoutMs: 15000, maxOutputChars: 4_000_000 });
  return JSON.parse(result.stdout) as string;
}

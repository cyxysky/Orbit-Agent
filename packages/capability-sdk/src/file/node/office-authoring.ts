import type { OfficeDocumentDraft } from '../office/types.ts';
import { inspectUnoApi } from './office/uno.ts';
import { htmlOfficeGuidance } from '../office/html.ts';
import { officeBodyVariables } from './office-body.ts';

/** Small format-specific installed-API reference delivered with a document plan. */
export async function officeAuthoringGuidance(draft: OfficeDocumentDraft) {
  const existingSource = Boolean(draft.program?.trim());
  const starterAllowed = !existingSource && draft.operation !== 'modify';
  const nextAction = { action: existingSource ? 'readSource' : 'generate', documentId: draft.documentId };
  if (draft.generator === 'html') return { ...htmlOfficeGuidance, preferredInput: 'body',
    bodyContract: 'Submit an HTML fragment. The SDK adds doctype, UTF-8 head, default styles and body. Use program for a complete custom HTML shell.',
    starterBody: starterAllowed ? draft.documentType === 'presentation'
      ? '<section data-slide><h1>Presentation title</h1><p>Replace with the requested content.</p></section>'
      : '<h1>Document title</h1><p>Replace with the requested content.</p>' : undefined,
    nextAction };
  if (draft.generator === 'javascript') return { kind: 'exceljs-authoring', preferredInput: 'body', sourceLanguage: 'javascript',
    bodyContract: 'workbook is an existing ExcelJS Workbook; job provides asset helpers. Write only worksheet/content operations. SDK owns createDocument and workbook.xlsx.writeFile(job.outputPath).',
    starterBody: starterAllowed ? "const sheet = workbook.addWorksheet('Summary');\nsheet.addRow(['Item', 'Value']);\nsheet.addRow(['Revenue', 1200]);\nsheet.getCell('B3').value = { formula: 'B2*2', result: 2400 };" : undefined,
    providedOperations: ['workbook.addWorksheet(name)', 'sheet.addRow(values)', 'sheet.getCell(address).value = value or {formula,result}', 'sheet.getColumn(index).width = number'],
    nextAction };
  const queries = draft.documentType === 'presentation' ? ['presentation.document', 'presentation.slide', 'presentation.text']
    : draft.documentType === 'word' ? ['writer.flow'] : ['calc.sheet', 'calc.cell-range'];
  const catalogs = await Promise.all(queries.map(query => inspectUnoApi({ documentType: draft.documentType, query, limit: 120 })));
  const signatures = [...new Set(catalogs.flatMap(catalog => Array.isArray(catalog.facadeSignatures) ? catalog.facadeSignatures : []))]
    .filter((signature): signature is string => typeof signature === 'string'
      && /^(?:deck\.(?:slide|save|close)|slide\.(?:add_text|add_bullets|grid|stack)|document\.(?:add_heading|add_title|add_paragraph)|workbook\.sheet|sheet\.(?:set_cell|set_range|set_formula|get_cell|get_range))\(/.test(signature));
  const schemas = Object.assign({}, ...catalogs.map(catalog => catalog.valueSchemas || {}));
  const examples = Object.assign({}, ...catalogs.map(catalog => catalog.examples || {}));
  const variable = officeBodyVariables[draft.documentType];
  const factory = { presentation: 'presentation', word: 'writer', spreadsheet: 'spreadsheet' }[draft.documentType];
  const body = draft.documentType === 'presentation'
    ? "slide = deck.slide('overview', layout='title-content', title='Presentation title')\nslide.add_text('summary', 'Replace with the requested content.', slot='body', style={'font_size': 20, 'min_font_size': 18})"
    : draft.documentType === 'word'
      ? "document.add_heading('title', 'Document title', level=1)\ndocument.add_paragraph('body', 'Replace with the requested content.')"
      : "sheet = workbook.sheet('summary', 'Summary')\nsheet.set_cell('label', 'A1', 'Revenue')\nsheet.set_cell('value', 'B1', 1200)\nsheet.set_cell('double', 'B2', '=B1*2')";
  return {
    kind: 'uno-office-authoring', documentType: draft.documentType, sourceLanguage: 'python', preferredInput: 'body',
    bodyContract: `Write only content/layout operations using the provided ${variable} facade and job asset helpers. The SDK owns the document factory, entrypoint, save and close. Do not add them to body.`,
    starterBody: starterAllowed ? body : undefined,
    entrypoint: 'Only advanced program input needs def create_document(job):. body input does not.',
    documentFactory: `${variable} = job.${factory}('document') is supplied by the SDK in body mode.`,
    lifecycle: 'SDK owns save/close for body. Advanced complete program must call facade.save() once and facade.close() once.',
    starterProgram: !starterAllowed ? undefined : [
      'def create_document(job):',
      `    ${variable} = job.${factory}('document')`,
      ...body.split('\n').map(line => `    ${line}`),
      `    ${variable}.save()`,
      `    ${variable}.close()`,
    ].join('\n'),
    providedOperations: signatures.map(signature => signature.slice(0, signature.indexOf('('))),
    signatures,
    valueSchemas: Object.fromEntries(['elementId', 'color', 'canvas', 'box', 'textStyle'].filter(key => schemas[key]).map(key => [key, schemas[key]])),
    examples: draft.documentType === 'presentation' ? { layouts: examples.layouts, text: examples.textAndPanel } : undefined,
    instruction: existingSource
      ? 'The existing draft is authoritative. Read only the needed source range and repair with edit; do not replace it with a starter.'
      : draft.operation === 'modify' ? 'The SDK opens the planned source asset. Query the existing-object APIs and preserve existing content; do not use a new-document template.'
      : 'Prefer body and implement the complete planned content/design. Starter content is an example, not a mandatory visual template. APIs listed here are already supplied; query unoApi only for additional features. Read/edit operate on the complete generated source, including its SDK wrapper.',
    nextAction,
  };
}

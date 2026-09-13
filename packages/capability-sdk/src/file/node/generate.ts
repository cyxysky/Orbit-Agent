import { generateHtmlOfficeDocument } from './office/html.ts';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { fileFormatForExtension, generatedFileExtensions, normalizedFileExtension } from '../formats.ts';
import type { OfficeCellValue, OfficeDocumentKind } from '../office/types.ts';
import { generateOfficeJsProgramDocument } from './office/javascript.ts';
import { generateUnoProgramDocument } from './office/uno.ts';

export type GeneratedFileCell = OfficeCellValue;
/** Text-only block extraction; Office output requires executable source. */
type TextFileBlock = {
  type: string; title?: string; text?: string; markdown?: string;
  children?: TextFileBlock[]; columns?: Array<{ blocks?: TextFileBlock[] }>;
  rows?: OfficeCellValue[][]; items?: unknown[];
};
export type GeneratedFileInput = { documentType: OfficeDocumentKind; fileName: string; blocks?: TextFileBlock[] };

export type GeneratedFileOutput = {
  buffer: Buffer;
  diagnostics?: unknown;
  extension: string;
  previewPdf?: Buffer;
};

export const generatedTextExtensions = generatedFileExtensions('text');
const wordExtensions = new Set(['.doc', '.docx', '.odt']);
const spreadsheetExtensions = new Set(['.xls', '.xlsx', '.ods']);
const presentationExtensions = new Set(['.ppt', '.pptx', '.odp']);

function childBlocks(block: TextFileBlock) {
  return [
    ...(Array.isArray(block.children) ? block.children : []),
    ...(Array.isArray(block.columns)
      ? block.columns.flatMap((column) => Array.isArray(column.blocks) ? column.blocks : [])
      : []),
  ];
}

function flattenBlocks(blocks: TextFileBlock[]): TextFileBlock[] {
  return blocks.flatMap((block) => [block, ...flattenBlocks(childBlocks(block))]);
}

function blockText(block: TextFileBlock): string {
  if (block.type === 'table' && Array.isArray(block.rows)) {
    return block.rows.map((row) => row.map((cell) => cell === null ? '' : String(cell)).join('\t')).join('\n');
  }
  if (block.type === 'list' && Array.isArray(block.items)) {
    return block.items.map((item) => typeof item === 'object' && item && 'text' in item
      ? String((item as { text?: unknown }).text || '')
      : String(item ?? '')).join('\n');
  }
  const own = String(block.markdown ?? block.text ?? block.title ?? '').trim();
  const nested = childBlocks(block).map(blockText).filter(Boolean).join('\n');
  return [own, nested].filter(Boolean).join('\n');
}

function documentText(input: GeneratedFileInput) {
  return (input.blocks || []).map(blockText).filter(Boolean).join('\n\n').replace(/\r\n?/g, '\n').trim();
}

function firstTableRows(input: GeneratedFileInput) {
  return flattenBlocks(input.blocks || []).find((block) => block.type === 'table' && Array.isArray(block.rows) && block.rows.length)?.rows;
}

function quotedDelimitedCell(value: GeneratedFileCell, delimiter: string) {
  const cell = value === null ? '' : String(value);
  if (!cell.includes(delimiter) && !/["\r\n]/.test(cell)) return cell;
  return `"${cell.replace(/"/g, '""')}"`;
}

function generateDelimitedText(input: GeneratedFileInput, extension: '.csv' | '.tsv') {
  const rows = firstTableRows(input);
  if (!rows?.length) throw new Error(`${extension.toUpperCase()} generation requires a non-empty table block.`);
  const delimiter = extension === '.tsv' ? '\t' : ',';
  return Buffer.from(`${rows.map((row) => row.map((cell) => quotedDelimitedCell(cell, delimiter)).join(delimiter)).join('\n')}\n`, 'utf8');
}

function validateOfficeTarget(input: Pick<GeneratedFileInput, 'documentType'>, extension: string) {
  if (wordExtensions.has(extension) && input.documentType !== 'word') throw new Error(`${extension} requires documentType=word.`);
  if (spreadsheetExtensions.has(extension) && input.documentType !== 'spreadsheet') throw new Error(`${extension} requires documentType=spreadsheet.`);
  if (presentationExtensions.has(extension) && input.documentType !== 'presentation') throw new Error(`${extension} requires documentType=presentation.`);
}

export function supportedGeneratedFileExtension(fileName: string) {
  const extension = normalizedFileExtension(fileName);
  const format = fileFormatForExtension(extension);
  return format?.canGenerate ? format.extension : undefined;
}

export async function generateFileBuffer(input: GeneratedFileInput & {
  program?: string;
  programPath?: string;
  assetsPath?: string;
  generator?: 'javascript' | 'uno' | 'html';
  requiredSourceAssetName?: string;
  abortSignal?: AbortSignal;
}): Promise<GeneratedFileOutput> {
  if ('spec' in input) throw new Error('spec generation has been removed. Use executable source.');
  const extension = supportedGeneratedFileExtension(input.fileName);
  if (!extension) throw new Error('Unsupported output extension. Use a supported text/data format, PDF, Word, Excel, PowerPoint, or OpenDocument extension.');
  if (generatedTextExtensions.has(extension)) {
    if (!input.blocks) throw new Error('Text file generation requires text blocks.');
    if (extension === '.csv' || extension === '.tsv') return { buffer: generateDelimitedText(input, extension), extension };
    const content = documentText(input);
    if (!content) throw new Error('Text file generation requires at least one textual block.');
    return { buffer: Buffer.from(`${content}\n`, 'utf8'), extension };
  }
  if ('blocks' in input) throw new Error('Structured Office generation has been removed. Use body or program through the file workspace, or program/programPath here.');
  if (!input.program?.trim() && !input.programPath) throw new Error('Office document generation requires program or programPath.');
  validateOfficeTarget(input, extension);
  const configured = input.generator || 'javascript';
  const generator = configured === 'javascript' && extension !== '.xlsx' ? 'html' : configured;
  const source = input.programPath ? { sourcePath: input.programPath } : { sourceCode: input.program };
  const generated = generator === 'html' ? await generateHtmlOfficeDocument({ ...source, fileName: path.basename(input.fileName), documentType: input.documentType, assetsPath: input.assetsPath, abortSignal: input.abortSignal }) : generator === 'javascript' ? await generateOfficeJsProgramDocument({
    ...source,
    fileName: path.basename(input.fileName),
    documentType: input.documentType,
    assetsPath: input.assetsPath,
    abortSignal: input.abortSignal,
  }) : await generateUnoProgramDocument({
    ...source,
    fileName: path.basename(input.fileName),
    documentType: input.documentType,
    assetsPath: input.assetsPath,
    requiredSourceAssetName: input.requiredSourceAssetName,
    abortSignal: input.abortSignal,
  });
  return {
    buffer: generated.buffer || (() => { throw new Error('Office generator did not return an in-memory artifact.'); })(),
    diagnostics: generated.report,
    extension,
    previewPdf: generated.previewPdf,
  };
}

export async function generateFileToPaths(input: Pick<GeneratedFileInput, 'documentType' | 'fileName'> & {
  programPath: string;
  outputPath: string;
  previewPath: string;
  assetsPath?: string;
  generator?: 'javascript' | 'uno' | 'html';
  requiredSourceAssetName?: string;
  abortSignal?: AbortSignal;
  onProgress?: (progress: { phase: string; message: string; current?: number; total?: number }) => void | Promise<void>;
}) {
  if ('spec' in input || 'blocks' in input) throw new Error('Structured Office generation has been removed. Use programPath.');
  const extension = supportedGeneratedFileExtension(input.fileName);
  if (!extension || generatedTextExtensions.has(extension)) throw new Error('Path-based generation requires an Office or PDF target.');
  validateOfficeTarget(input, extension);
  if (!input.programPath?.trim()) throw new Error('Path-based generation requires programPath.');
  const configured = input.generator || 'javascript';
  const generator = configured === 'javascript' && extension !== '.xlsx' ? 'html' : configured;
  const source = { sourcePath: input.programPath };
  const generated = generator === 'html'
    ? await generateHtmlOfficeDocument({ ...source, fileName: path.basename(input.fileName), documentType: input.documentType, assetsPath: input.assetsPath, abortSignal: input.abortSignal, outputPath: input.outputPath, previewPath: input.previewPath, onProgress: input.onProgress })
    : generator === 'javascript'
    ? await generateOfficeJsProgramDocument({
        ...source,
        fileName: path.basename(input.fileName),
        documentType: input.documentType,
        assetsPath: input.assetsPath,
        abortSignal: input.abortSignal,
        outputPath: input.outputPath,
        previewPath: input.previewPath,
        onProgress: input.onProgress,
      })
    : await generateUnoProgramDocument({
        ...source,
        fileName: path.basename(input.fileName),
        documentType: input.documentType,
        assetsPath: input.assetsPath,
        requiredSourceAssetName: input.requiredSourceAssetName,
        abortSignal: input.abortSignal,
        outputPath: input.outputPath,
        previewPath: input.previewPath,
        onProgress: input.onProgress,
      });
  return {
    bytes: (await stat(input.outputPath)).size,
    diagnostics: generated.report,
    extension,
    outputPath: input.outputPath,
    previewPath: input.previewPath,
  };
}

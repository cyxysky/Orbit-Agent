import type { TextDocument, TextDocumentSummary, TextFormat } from '@cjfclonedeep/capability-sdk/text-editor';
export type { TextDocument, TextDocumentSummary, TextFormat };
export type TextDraft = Pick<TextDocument, 'title' | 'format' | 'content'>;
export type TextSelection = { start: number; end: number; text: string };
export type TextEditProposal = { id: string; documentId: string; start: number; end: number; original: string; replacement: string; wholeDocument: boolean };
export type TextEditorResponse = { documents?: TextDocumentSummary[]; document?: TextDocument; proposal?: TextEditProposal; deletedDocumentId?: string };
export function textDocumentIdFromFile(fileName: string) { return fileName.match(/^(text_[a-f0-9-]{36})-.+\.(?:txt|md|html)$/i)?.[1]; }
export function textFormatFromFile(fileName: string): TextFormat { return /\.(?:html?|xhtml)$/i.test(fileName) ? 'html' : /\.(?:md|markdown)$/i.test(fileName) ? 'markdown' : 'text'; }
export function textFileExtension(format: TextFormat) { return format === 'markdown' ? 'md' : format === 'html' ? 'html' : 'txt'; }
export function textPreviewHtml(content: string) {
  // Source is kept verbatim. The opaque iframe and CSP confine its rendering.
  const policy = "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'; script-src 'none'";
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:24px;font:16px/1.7 system-ui;overflow-wrap:anywhere}img,svg{max-width:100%;height:auto}pre{overflow:auto}</style>`;
  return `<!doctype html><html><head>${head}</head><body>${content}</body></html>`;
}

import type { PDFDocumentProxy } from 'pdfjs-dist';

export type PdfDocumentOptions = { signal?: AbortSignal; password?: string };
export type PdfTextOptions = { pages?: readonly number[]; signal?: AbortSignal };
export function withPdfDocument<T>(data: Uint8Array, operation: (document: PDFDocumentProxy) => T | Promise<T>, options?: PdfDocumentOptions): Promise<T>;
export function iteratePdfText(document: PDFDocumentProxy, options?: PdfTextOptions): AsyncGenerator<{ pageNumber: number; text: string }>;
export function inspectPdfDocument(data: Uint8Array, options?: PdfDocumentOptions): Promise<{ pages: number; textCharacters: number }>;
export function renderPdfPage(document: PDFDocumentProxy, pageNumber: number, options?: { width?: number; maxPixels?: number; signal?: AbortSignal }): Promise<{ data: Uint8Array; width: number; height: number }>;

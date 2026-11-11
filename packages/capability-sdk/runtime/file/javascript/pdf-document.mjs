import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
let engine;

function pdfEngine() {
  return engine ??= import('pdfjs-dist/legacy/build/pdf.mjs').catch(error => {
    engine = undefined;
    throw error;
  });
}

/** One document owns its loading task, input copy and worker resources. */
export async function withPdfDocument(data, operation, { signal, password } = {}) {
  signal?.throwIfAborted();
  const pdfjs = await pdfEngine();
  signal?.throwIfAborted();
  const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const assetDirectory = name => path.join(root, name).split(path.sep).join('/') + '/';
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(root, 'legacy/build/pdf.worker.mjs')).href;
  const loading = pdfjs.getDocument({
    // PDF.js transfers this array to its worker; never detach a caller's buffer.
    data: new Uint8Array(data), password,
    cMapUrl: assetDirectory('cmaps'), cMapPacked: true,
    standardFontDataUrl: assetDirectory('standard_fonts'),
    wasmUrl: assetDirectory('wasm'),
    useWorkerFetch: false, isEvalSupported: false, verbosity: 0,
  });
  const abort = () => { void loading.destroy().catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    const document = await loading.promise;
    signal?.throwIfAborted();
    const result = await operation(document);
    signal?.throwIfAborted();
    return result;
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    await loading.destroy();
  }
}

function selectedPages(document, pages) {
  if (!pages?.length) return Array.from({ length: document.numPages }, (_, i) => i + 1);
  if (pages.some(page => !Number.isSafeInteger(page) || page < 1 || page > document.numPages)) {
    throw new RangeError('Requested PDF page is outside the document page count: ' + document.numPages);
  }
  return [...new Set(pages)].sort((a, b) => a - b);
}

/** Stream one text layer at a time, preserving PDF.js spaces and line endings. */
export async function* iteratePdfText(document, { pages, signal } = {}) {
  for (const pageNumber of selectedPages(document, pages)) {
    signal?.throwIfAborted();
    const page = await document.getPage(pageNumber);
    try {
      const content = await page.getTextContent();
      signal?.throwIfAborted();
      const text = content.items.flatMap(item => 'str' in item
        ? [item.str, ...(item.hasEOL ? ['\n'] : [])] : []).join('').trim();
      yield { pageNumber, text };
    } finally {
      page.cleanup();
    }
  }
}

/** Counts actual text only, without retaining the entire extracted document. */
export function inspectPdfDocument(data, options) {
  return withPdfDocument(data, async document => {
    let textCharacters = 0;
    for await (const page of iteratePdfText(document, options)) textCharacters += page.text.replace(/\s+/g, '').length;
    return { pages: document.numPages, textCharacters };
  }, options);
}

/** Rasterize a single bounded page and release the native canvas immediately. */
export async function renderPdfPage(document, pageNumber, { width = 1400, maxPixels = 16_000_000, signal } = {}) {
  selectedPages(document, [pageNumber]);
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(maxPixels) || maxPixels < 1) {
    throw new RangeError('PDF render width and pixel limit must be positive integers.');
  }
  signal?.throwIfAborted();
  const page = await document.getPage(pageNumber);
  let canvas, rendering;
  const abort = () => rendering?.cancel();
  try {
    const original = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / original.width });
    const height = Math.ceil(viewport.height);
    if (!Number.isSafeInteger(height) || height < 1 || width * height > maxPixels) {
      throw new RangeError('PDF page exceeds the render pixel limit: ' + maxPixels);
    }
    // Canvas and PDF.js must share the same native Path2D/DOMMatrix bindings.
    const pdfRequire = createRequire(require.resolve('pdfjs-dist/package.json'));
    const { createCanvas } = pdfRequire('@napi-rs/canvas');
    signal?.throwIfAborted();
    canvas = createCanvas(width, height);
    rendering = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport });
    signal?.addEventListener('abort', abort, { once: true });
    await rendering.promise;
    signal?.throwIfAborted();
    return { data: canvas.toBuffer('image/png'), width, height };
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    page.cleanup();
  }
}

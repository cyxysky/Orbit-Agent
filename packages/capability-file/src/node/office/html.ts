import { chromium } from 'playwright';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun, ExternalHyperlink, AlignmentType, HeadingLevel, WidthType, ShadingType, LineRuleType } from 'docx';
import PptxGenJS from 'pptxgenjs';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CapabilityTaskQueue } from '@webpilot/capability-sdk';
import { assertHtmlOfficeSource } from '../../office/html.ts';
import type { OfficeDocumentKind } from '../../office/types.ts';
import { collectHtmlDocument, serializeHtmlAsset, inspectHtmlPrintLayout, type HtmlBlock, type HtmlDocumentModel } from './html-dom.ts';
import { convertOfficeFileToPath } from '../libreoffice.ts';

const queue = new CapabilityTaskQueue({ concurrency: 2, maxQueued: 16, queueTimeoutMs: 120000 });
const alignment = (value: string) => value === 'center' ? AlignmentType.CENTER : value === 'right' || value === 'end' ? AlignmentType.RIGHT : value === 'justify' ? AlignmentType.JUSTIFIED : AlignmentType.LEFT;
type Assets = Map<string, Buffer>;

function wordBlocks(blocks: HtmlBlock[], assets: Assets, maxWidth = 640, maxHeight = 920): Array<Paragraph | Table> {
  return blocks.flatMap((block): Array<Paragraph | Table> => {
    if (block.kind === 'image' && block.image) {
      const scale = Math.min(1, maxWidth / block.image.width, maxHeight / block.image.height);
      return [new Paragraph({ alignment: alignment(block.style.align), keepLines: true, keepNext: block.keepNext, pageBreakBefore: block.style.breakBefore,
        spacing: { before: Math.round(block.style.marginTop * 15), after: Math.round(block.style.marginBottom * 15) },
        children: [new ImageRun({ data: assets.get(block.image.key)!, type: 'png', transformation: { width: Math.round(block.image.width * scale), height: Math.round(block.image.height * scale) } })] })];
    }
    if (block.kind === 'table') {
      const scale = Math.min(1, maxWidth / block.rect.width);
      return [new Table({ width: { size: Math.round(Math.min(maxWidth, block.rect.width) * 15), type: WidthType.DXA }, rows: (block.rows || []).map((row) => new TableRow({ cantSplit: true, children: row.map((cell) => {
        const content = wordBlocks(cell.blocks, assets, Math.min(maxWidth, cell.width * scale), maxHeight);
        return new TableCell({ columnSpan: cell.colspan, rowSpan: cell.rowspan, width: { size: Math.max(1, Math.round(cell.width * scale * 15)), type: WidthType.DXA },
          shading: cell.style.background ? { type: ShadingType.CLEAR, fill: cell.style.background } : undefined,
          children: content.length ? content : [new Paragraph('')],
        });
      }) })) })];
    }
    const children = block.runs.flatMap<TextRun | ExternalHyperlink>((run) => {
      const pieces = run.text.split('\n');
      const texts = pieces.map((text, index) => new TextRun({ text, break: index ? 1 : undefined, font: run.style.font, size: Math.round(run.style.size * 1.5),
        color: run.style.color, bold: run.style.bold, italics: run.style.italic, underline: run.style.underline ? {} : undefined }));
      return run.href && /^(https?:|mailto:)/i.test(run.href) ? [new ExternalHyperlink({ link: run.href, children: texts })] : texts;
    });
    if (block.list?.ordered) children.unshift(new TextRun(`${block.list.index}. `));
    const headings = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
    return [new Paragraph({ children, alignment: alignment(block.style.align), heading: /^h[1-6]$/.test(block.tag) ? headings[Number(block.tag[1]) - 1] : undefined,
      bullet: block.list && !block.list.ordered ? { level: Math.min(8, block.list.level) } : undefined,
      indent: block.list?.ordered ? { left: 360 * (block.list.level + 1) } : undefined,
      keepNext: block.keepNext || /^h[1-6]$/.test(block.tag), keepLines: block.style.breakInsideAvoid, widowControl: true,
      pageBreakBefore: block.style.breakBefore, spacing: { before: Math.round(block.style.marginTop * 15), after: Math.round(block.style.marginBottom * 15),
        line: Math.round(block.style.lineHeight * 15), lineRule: LineRuleType.AT_LEAST },
    })];
  });
}

function writeSlides(model: HtmlDocumentModel, assets: Assets) {
  if (!model.explicitSlides) throw new Error('PPTX HTML requires one <section data-slide> with explicit width/height per slide.');
  if (model.unsupported.length) throw new Error(`PPTX cannot map these CSS features to editable objects; use img/SVG artwork: ${[...new Set(model.unsupported)].slice(0, 12).join('; ')}`);
  const first = model.slides[0].rect;
  if (first.width <= 0 || first.height <= 0 || first.width > 4096 || first.height > 4096) throw new Error('Slide dimensions must be positive and at most 4096 CSS pixels.');
  const deck = new PptxGenJS();
  deck.defineLayout({ name: 'HTML', width: first.width / 96, height: first.height / 96 }); deck.layout = 'HTML'; deck.title = model.title;
  for (const surface of model.slides) {
    if (Math.abs(surface.rect.width - first.width) > 1 || Math.abs(surface.rect.height - first.height) > 1) throw new Error('All HTML slides must have the same dimensions.');
    const slide = deck.addSlide(); slide.background = { color: surface.style.background || 'FFFFFF' };
    const geometry = (rect: HtmlBlock['rect']) => ({ x: (rect.x - surface.rect.x) / 96, y: (rect.y - surface.rect.y) / 96, w: rect.width / 96, h: rect.height / 96 });
    for (const decoration of surface.decorations) {
      const g = geometry(decoration.rect);
      if (decoration.image) {
        slide.addImage({ ...g, data: 'data:image/png;base64,' + assets.get(decoration.image.key)!.toString('base64') });
        continue;
      }
      if (decoration.style.background) slide.addShape(decoration.style.radius ? deck.ShapeType.roundRect : deck.ShapeType.rect, { ...g, rectRadius: decoration.style.radius / 96,
        fill: { color: decoration.style.background }, line: { transparency: 100 } });
      const edges = [{ x: g.x, y: g.y, w: g.w, h: 0 }, { x: g.x + g.w, y: g.y, w: 0, h: g.h }, { x: g.x, y: g.y + g.h, w: g.w, h: 0 }, { x: g.x, y: g.y, w: 0, h: g.h }];
      decoration.style.borders.forEach((width, index) => {
        if (width) slide.addShape(deck.ShapeType.line, { ...edges[index], line: { color: decoration.style.borderColors[index], width: width * 0.75 } });
      });
    }
    for (const block of surface.blocks) {
      const g = geometry(block.rect);
      if (g.x < -0.02 || g.y < -0.02 || g.x + g.w > first.width / 96 + 0.02 || g.y + g.h > first.height / 96 + 0.02) throw new Error(`HTML content overflows a slide: ${block.tag}. Resize or paginate the source.`);
      if (block.kind === 'image' && block.image) slide.addImage({ ...g, data: 'data:image/png;base64,' + assets.get(block.image.key)!.toString('base64') });
      else if (block.kind === 'table') {
        if (block.rows?.some((row) => row.some((cell) => cell.blocks.some((b) => b.kind !== 'paragraph')))) throw new Error('PPTX tables support text cells. Place images or nested tables outside the table in the HTML slide.');
        const rows = (block.rows || []).map((row) => row.map((cell) => ({ text: cell.blocks.flatMap((b) => b.runs.map((r) => r.text)).join('\n'), options: {
          colspan: cell.colspan, rowspan: cell.rowspan, fill: cell.style.background ? { color: cell.style.background } : undefined, color: cell.style.color, fontFace: cell.style.font, fontSize: cell.style.size * 0.75,
          bold: cell.style.bold, margin: cell.style.padding.map((p) => p * 0.75) as [number, number, number, number],
        } })));
        slide.addTable(rows, { ...g, colW: block.rows?.[0]?.flatMap((c) => Array.from({ length: c.colspan }, () => c.width / c.colspan / 96)), autoPage: false, margin: 0, border: { type: 'solid', pt: 0.5, color: 'BFC5CE' } });
      } else {
        // Browser line boxes preserve wrapping and independently positioned
        // inline content. Reflowing a whole DOM block in Office loses both.
        for (const run of block.runs) for (const fragment of run.boxes || []) {
          if (!fragment.text.trim()) continue;
          slide.addText(fragment.text, { ...geometry(fragment.rect), margin: 0, wrap: false, valign: 'middle',
            fontFace: run.style.font, fontSize: run.style.size * 0.75, bold: run.style.bold, italic: run.style.italic,
            color: run.style.color, charSpacing: run.style.letterSpacing * 0.75,
            underline: run.style.underline ? { style: 'sng' } : undefined,
            hyperlink: run.href && /^https?:/i.test(run.href) ? { url: run.href } : undefined, paraSpaceAfter: 0 });
        }
        const firstLine = block.runs.flatMap((run) => run.boxes || []).find((fragment) => fragment.text.trim());
        if (block.list && firstLine) {
          const markerWidth = block.style.size * (block.list.ordered ? String(block.list.index).length + 1 : 1);
          slide.addText(block.list.ordered ? `${block.list.index}.` : '\u2022', { ...geometry(firstLine.rect),
            x: (firstLine.rect.x - surface.rect.x - markerWidth - 4) / 96, w: markerWidth / 96, margin: 0, wrap: false,
            fontFace: block.style.font, fontSize: block.style.size * 0.75, color: block.style.color, align: 'right', valign: 'middle' });
        }
      }
    }
  }
  return deck;
}

export async function generateHtmlOfficeDocument(input: {
  sourceCode?: string; sourcePath?: string; fileName: string; documentType: OfficeDocumentKind; assetsPath?: string;
  outputPath?: string; previewPath?: string; abortSignal?: AbortSignal;
  onProgress?: (progress: { phase: string; message: string; current?: number; total?: number }) => void | Promise<void>;
}) {
  if (Boolean(input.sourceCode) === Boolean(input.sourcePath)) throw new Error('HTML generation requires exactly one sourceCode or sourcePath.');
  const source = input.sourceCode ?? await readFile(input.sourcePath!, 'utf8'); assertHtmlOfficeSource(source);
  const extension = path.extname(input.fileName).toLowerCase();
  if (!['.pdf', '.docx', '.pptx'].includes(extension)) throw new Error('HTML generation supports PDF, DOCX and PPTX. XLSX uses the JavaScript spreadsheet engine.');
  return queue.run(async (signal) => {
    const abortSignal = AbortSignal.any([signal, AbortSignal.timeout(180000)]);
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'webpilot-html-'));
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    const stop = () => { void browser?.close().catch(() => undefined); };
    abortSignal.addEventListener('abort', stop, { once: true });
    try {
      abortSignal.throwIfAborted();
      const outputPath = input.outputPath || path.join(temporary, `output${extension}`);
      const previewPath = input.previewPath || path.join(temporary, 'preview.pdf');
      await Promise.all([mkdir(path.dirname(outputPath), { recursive: true }), mkdir(path.dirname(previewPath), { recursive: true })]);
      await input.onProgress?.({ phase: 'html-layout', message: 'Rendering HTML layout' });
      browser = await chromium.launch({ headless: true }); abortSignal.throwIfAborted();
      const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
      const assetsRoot = await realpath(input.assetsPath || temporary);
      const failedResources: string[] = [];
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === 'https://document.local' && url.pathname === '/document.html') return route.fulfill({ body: source, contentType: 'text/html; charset=utf-8' });
        if (url.origin === 'https://document.local' && url.pathname === '/__office_asset__.html') return route.fulfill({ body: '<!doctype html><html><head></head><body></body></html>', contentType: 'text/html' });
        try {
          if (url.origin !== 'https://document.local') throw new Error('Remote resource');
          const candidate = await realpath(path.resolve(assetsRoot, '.' + decodeURIComponent(url.pathname)));
          const relative = path.relative(assetsRoot, candidate);
          if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Resource outside assets directory');
          const types: Record<string,string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.css': 'text/css', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
          const contentType = types[path.extname(candidate).toLowerCase()];
          if (!contentType) throw new Error('Unsupported resource');
          await route.fulfill({ body: await readFile(candidate), contentType });
        } catch { failedResources.push(url.pathname); await route.abort(); }
      });
      const page = await context.newPage();
      await page.goto('https://document.local/document.html', { waitUntil: 'load', timeout: 30000 });
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images).map((img) => img.decode())); });
      if (failedResources.length) throw new Error(`HTML resources unavailable; use downloaded local assets: ${failedResources.slice(0, 10).join(', ')}`);
      const assets: Assets = new Map();
      if (extension === '.pdf') {
        await page.emulateMedia({ media: 'print' });
        const print = await page.evaluate(inspectHtmlPrintLayout);
        await page.setViewportSize({ width: print.width, height: print.height });
        const { issues } = await page.evaluate(inspectHtmlPrintLayout);
        if (issues.length) throw new Error(`HTML_PRINT_LAYOUT_INVALID: ${issues.slice(0, 8).join(' ')}`);
        await page.pdf({ path: outputPath, format: 'A4', printBackground: true, preferCSSPageSize: true });
        if (path.resolve(outputPath) !== path.resolve(previewPath)) await copyFile(outputPath, previewPath);
      } else {
        if (extension === '.docx') {
          // Measure the same usable width as the target Word page, rather than
          // a desktop viewport that creates oversized images and tables.
          await page.setViewportSize({ width: 642, height: 971 });
        }
        const model = await page.evaluate(collectHtmlDocument, { positionedText: extension === '.pptx' });
        if (!model.blocks.length) throw new Error('HTML contains no visible document content.');
        const assetPage = await context.newPage();
        await assetPage.goto('https://document.local/__office_asset__.html', { waitUntil: 'load' });
        for (const asset of model.assets) {
          if (asset.width > 8192 || asset.height > 8192) throw new Error('HTML image exceeds the 8192 pixel rendering limit.');
          const paint = await page.evaluate(serializeHtmlAsset, asset.key);
          await assetPage.setViewportSize({ width: Math.max(1, Math.ceil(asset.width)), height: Math.max(1, Math.ceil(asset.height)) });
          await assetPage.setContent('<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent}</style></head><body></body></html>');
          await assetPage.evaluate(({ html, fonts }) => {
            const style = document.createElement('style'); style.textContent = fonts; document.head.append(style);
            document.body.innerHTML = html;
          }, paint);
          await assetPage.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images).map((img) => img.decode())); });
          assets.set(asset.key, await assetPage.locator('body > :first-child').screenshot({ type: 'png', omitBackground: true }));
        }
        await assetPage.close();
        if (failedResources.length) throw new Error(`HTML asset resources unavailable: ${failedResources.slice(0, 10).join(', ')}`);
        await input.onProgress?.({ phase: 'html-convert', message: `Converting HTML to ${extension}` });
        if (extension === '.docx') {
          const doc = new Document({ title: model.title, sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } }, children: wordBlocks(model.blocks, assets) }] });
          await writeFile(outputPath, await Packer.toBuffer(doc), { signal: abortSignal });
        } else await writeSlides(model, assets).writeFile({ fileName: outputPath });
        await input.onProgress?.({ phase: 'reopen', message: 'Reopening the generated Office file for preview' });
        if (!await convertOfficeFileToPath({ absolutePath: outputPath, sourceExtension: extension, targetExtension: '.pdf', targetPath: previewPath, abortSignal })) throw new Error('LibreOffice is required to reopen and preview HTML-generated Office files.');
      }
      abortSignal.throwIfAborted();
      return { buffer: input.outputPath ? undefined : await readFile(outputPath), outputPath,
        previewPdf: input.previewPath ? undefined : await readFile(previewPath), previewPath,
        report: { generator: 'html', sourceLanguage: 'html', requestedExtension: extension, authoredExtension: extension, convertedToPdf: extension === '.pdf', visualAssets: assets.size } };
    } finally {
      abortSignal.removeEventListener('abort', stop); await browser?.close().catch(() => undefined);
      await rm(temporary, { recursive: true, force: true });
    }
  }, { abortSignal: input.abortSignal });
}

export function htmlOfficeRuntimeSource() { return [assertHtmlOfficeSource, collectHtmlDocument, serializeHtmlAsset, inspectHtmlPrintLayout, wordBlocks, writeSlides, generateHtmlOfficeDocument].map((fn) => fn.toString()).join('\n'); }

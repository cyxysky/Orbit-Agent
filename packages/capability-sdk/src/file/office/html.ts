/** Public authoring contract; independent of Node and browser packages. */
export const htmlOfficeGuidance = {
  sourceLanguage: 'html',
  sourceField: 'program',
  workflow: 'plan -> jsApi(documentId) -> generate(program: complete HTML) -> edit -> render -> visual QA',
  rules: [
    'Submit a complete <!doctype html><html><head><meta charset="utf-8"><style>...</style></head><body>...</body></html> document as program. Do not write createDocument(job) or JavaScript.',
    'PDF: Chromium prints HTML/CSS with backgrounds and @page size/margins. Use break-before/after for pagination. Text remains selectable.',
    'PDF layout: use physical page units and box-sizing:border-box. A4 with 18mm top/bottom margins has 261mm printable height. Do not use 100vh plus padding for a cover. Scope chapter breaks to chapter containers, never all h1 elements; reset break-before:auto on headings inside a fixed page/cover. Use 11-12pt body text, break-after:avoid on headings and break-inside:avoid on figures/table rows. Constrain figure height to the printable area and keep its caption together.',
    'PPTX: each slide is a top-level <section data-slide> with explicit pixel width/height, e.g. 1280x720. All slides must have equal dimensions. Text, solid backgrounds, simple borders and tables become editable native objects; img and inline svg become image assets. Lay out with HTML/CSS. No whole-slide screenshots.',
    'DOCX: use semantic h1-h6, p, ul/ol/li, table/tr/td/th, img, svg, and a. Paragraphs, styled text, lists, links and tables stay native. Word pagination is flowing; browser grid/flex/absolute layout is not preserved. Avoid decorative layouts requiring fixed positioning.',
    'Design for the output: do not reuse a slide or dashboard layout as a flowing Word/PDF document. For PPTX at 1280x720, use 40-56px titles and 24-32px body text, with captions normally at least 16px. Give photographs meaningful visual space and distribute content across the slide. CSS pixels become 0.75pt in Office. Use figure/figcaption for images and captions, keep tables concise, and split dense slides instead of shrinking text.',
    'Assets: use relative URLs matching names in availableAssets, or inline data images/SVG. Remote assets must first be downloaded using file.download. Scripts, iframe/object/embed, forms, media playback and canvas are not supported.',
    'PPTX gradient/image backgrounds are rendered as separate decoration images; text stays editable and images retain object-fit. Put decorations on the section background or behind content. Shadows, transforms and pseudo-element content are rejected where native mapping cannot preserve them; use explicit SVG artwork for those effects. Charts imported as SVG/images are not native Office chart objects.',
    'Visual QA must inspect the reopened output pages, including image pixels, text size, wrapping, contrast and pagination. Embedded image counts and a successful conversion do not prove images are visible or a layout is good. Do not claim QA passed while the draft remains qa-pending or reviewed pages show defects.',
    'Read/edit addresses HTML lines and exact replacements. Re-render the same draft after changes; no Python or JS source wrappers and no semantic spec for HTML drafts.',
    'Spreadsheet .xlsx generation continues to use createDocument(job) with job.ExcelJS. Markdown/TXT/HTML/JS/CSS/JSON/YAML/CSV and other text files use file.write(fileName,content), in every generation mode, preserving exact UTF-8 bytes.',
  ],
  example: '<!doctype html>\n<html><head><meta charset="utf-8"><style>body{margin:0;font-family:Arial}section[data-slide]{box-sizing:border-box;width:1280px;height:720px;padding:64px;background:#fff}h1{font-size:48px}p{font-size:28px}</style></head>\n<body><section data-slide><h1>Project summary</h1><p>Key finding and supporting evidence.</p><table><tr><th>Item</th><th>Value</th></tr><tr><td>Completed</td><td>12</td></tr></table></section></body></html>',
} as const;

export function assertHtmlOfficeSource(source: string) {
  if (!/^\s*<!doctype\s+html\s*>/i.test(source) || !/<html[\s>]/i.test(source) || !/<body[\s>]/i.test(source) || !/<\/html\s*>\s*$/i.test(source)) {
    throw new Error('HTML generation requires a complete <!doctype html><html>...<body>...</body></html> document in program.');
  }
  if (/<(?:script|iframe|object|embed|canvas|video|audio|form)\b/i.test(source)) throw new Error('HTML documents must be static: script, iframe, object, embed, canvas, media and form elements are not supported.');
}

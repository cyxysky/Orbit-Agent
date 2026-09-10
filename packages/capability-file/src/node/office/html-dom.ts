/** Executed in Chromium by Playwright. Keep this function self-contained. */
export function collectHtmlDocument(options: { positionedText?: boolean } = {}) {
  const color = (value: string) => {
    const values = value.match(/[\d.]+/g)?.map(Number);
    return !values || values.length < 3 || values[3] === 0 ? undefined : values.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
  };
  const box = (element: Element) => {
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  const visible = (element: Element) => { const s = getComputedStyle(element); const r = box(element); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const style = (element: Element) => {
    const s = getComputedStyle(element);
    return { color: color(s.color) || '000000', background: color(s.backgroundColor), backgroundImage: s.backgroundImage !== 'none', font: s.fontFamily.split(',')[0].replace(/["']/g, ''),
      size: parseFloat(s.fontSize), bold: Number(s.fontWeight) >= 600, italic: s.fontStyle === 'italic', underline: s.textDecorationLine.includes('underline'),
      align: s.textAlign, lineHeight: parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.2, marginTop: parseFloat(s.marginTop), marginBottom: parseFloat(s.marginBottom),
      padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map(parseFloat),
      border: Math.max(...[s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].map(parseFloat)),
      borders: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].map(parseFloat),
      borderColors: [s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor].map((c) => color(c) || '000000'),
      borderColor: color(s.borderTopColor), radius: parseFloat(s.borderTopLeftRadius),
      breakBefore: s.breakBefore === 'page' || s.pageBreakBefore === 'always',
      breakInsideAvoid: s.breakInside.startsWith('avoid'), letterSpacing: parseFloat(s.letterSpacing) || 0,
    };
  };
  const textBoxes = (node: Node) => {
    const boxes: Array<{ text: string; rect: ReturnType<typeof box> }> = [];
    if (!options.positionedText) return boxes;
    const range = document.createRange();
    const preserveSpace = /pre/.test(getComputedStyle(node.parentElement!).whiteSpace);
    let offset = 0;
    for (const character of node.textContent || '') {
      range.setStart(node, offset); offset += character.length; range.setEnd(node, offset);
      const r = range.getBoundingClientRect();
      if (r.width < 0.01 || r.height < 0.01) continue;
      const text = preserveSpace ? character : character.replace(/[\t\r\n]/g, ' ');
      const last = boxes.at(-1);
      if (last && Math.abs(last.rect.y - r.y) < 1 && Math.abs(last.rect.x + last.rect.width - r.x) < 1) {
        last.text += text; last.rect.width = r.right - last.rect.x;
      } else boxes.push({ text, rect: { x: r.x, y: r.y, width: r.width, height: r.height } });
    }
    return boxes;
  };
  const runs = (element: Element) => {
    const result: Array<{ text: string; style: ReturnType<typeof style>; href?: string; boxes?: ReturnType<typeof textBoxes> }> = [];
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE && node.textContent) {
        const parent = node.parentElement!;
        const whitespace = getComputedStyle(parent).whiteSpace;
        const text = /pre/.test(whitespace) ? node.textContent : node.textContent.replace(/\s+/g, ' ');
        if (text.trim() || result.length) result.push({ text, style: style(parent), href: parent.closest('a')?.getAttribute('href') || undefined, boxes: textBoxes(node) });
      } else if (node instanceof Element && (node.tagName === 'BR' || visible(node)) && !['IMG', 'SVG', 'TABLE', 'UL', 'OL'].includes(node.tagName.toUpperCase())) {
        if (node.tagName === 'BR') result.push({ text: '\n', style: style(node) });
        else node.childNodes.forEach(walk);
      }
    };
    element.childNodes.forEach(walk);
    return result;
  };
  let sequence = 0;
  const visual = (element: Element, decoration = false) => {
    const key = element.getAttribute('data-office-asset') || `html-asset-${sequence++}`; element.setAttribute('data-office-asset', key);
    if (decoration) element.setAttribute('data-office-decoration', 'true');
    return { key, ...box(element) };
  };
  type Block = { kind: 'paragraph' | 'image' | 'table'; tag: string; rect: ReturnType<typeof box>; style: ReturnType<typeof style>; runs: ReturnType<typeof runs>; keepNext?: boolean; image?: ReturnType<typeof visual>; rows?: Array<Array<{ blocks: Block[]; width: number; colspan: number; rowspan: number; style: ReturnType<typeof style> }>>; list?: { ordered: boolean; level: number; index: number } };
  const blocks = (parent: Element): Block[] => {
    const result: Block[] = [];
    const add = (element: Element) => {
      if (!visible(element) || ['STYLE', 'LINK', 'META', 'TITLE'].includes(element.tagName)) return;
      const tag = element.tagName.toLowerCase();
      const base = { tag, rect: box(element), style: style(element), runs: runs(element) };
      if (tag === 'img' || tag === 'svg') { result.push({ ...base, kind: 'image', image: visual(element), runs: [] }); return; }
      if (tag === 'table') {
        const rows = Array.from((element as HTMLTableElement).rows).map((row) => Array.from(row.cells).map((cell) => ({ blocks: blocks(cell), width: box(cell).width, colspan: cell.colSpan, rowspan: cell.rowSpan, style: style(cell) })));
        result.push({ ...base, kind: 'table', rows, runs: [] }); return;
      }
      const isParagraph = /^(h[1-6]|p|li|pre|blockquote|dt|dd)$/.test(tag) || !Array.from(element.children).some((child) => !['inline', 'inline-block'].includes(getComputedStyle(child).display) && !['IMG', 'SVG', 'BR'].includes(child.tagName.toUpperCase()));
      if (isParagraph) {
        if (base.runs.some((run) => run.text.trim())) {
          let level = -1; for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) if (['UL', 'OL'].includes(ancestor.tagName)) level++;
          const list = tag === 'li' ? { ordered: element.parentElement?.tagName === 'OL', level: Math.max(0, level), index: Array.from(element.parentElement!.children).indexOf(element) + Number(element.parentElement?.getAttribute('start') || 1) } : undefined;
          result.push({ ...base, kind: 'paragraph', list });
        }
        for (const child of Array.from(element.children)) if (['IMG', 'SVG', 'UL', 'OL'].includes(child.tagName.toUpperCase())) add(child);
      } else {
        const start = result.length;
        for (const child of Array.from(element.childNodes)) {
          if (child instanceof Element) add(child);
          else if (child.textContent?.trim()) result.push({ ...base, kind: 'paragraph', runs: [{ text: child.textContent.trim(), style: base.style, boxes: textBoxes(child) }] });
        }
        if (result[start] && base.style.breakBefore) result[start].style.breakBefore = true;
        if (tag === 'figure' || base.style.breakInsideAvoid) {
          for (let index = start; index < result.length - 1; index += 1) result[index].keepNext = true;
        }
      }
    };
    if (['TD', 'TH'].includes(parent.tagName) && !Array.from(parent.children).some((e) => /^(P|DIV|TABLE|UL|OL|H[1-6])$/.test(e.tagName))) {
      result.push({ kind: 'paragraph', tag: 'p', rect: box(parent), style: style(parent), runs: runs(parent) });
      parent.querySelectorAll('img,svg').forEach(add);
    } else Array.from(parent.childNodes).forEach((child) => {
      if (child instanceof Element) add(child);
      else if (child.textContent?.trim()) result.push({ kind: 'paragraph', tag: 'p', rect: box(parent), style: style(parent), runs: [{ text: child.textContent.trim(), style: style(parent), boxes: textBoxes(child) }] });
    });
    return result;
  };
  const slides = Array.from(document.querySelectorAll<HTMLElement>('[data-slide]')).filter((slide) => !slide.parentElement?.closest('[data-slide]'));
  const surfaces = slides.length ? slides : [document.body];
  return { title: document.title, blocks: blocks(document.body), slides: surfaces.map((surface) => ({
    rect: box(surface), style: style(surface), blocks: blocks(surface),
    decorations: [surface, ...surface.querySelectorAll('*')].filter((e) => visible(e) && !e.closest('table,svg') && !['IMG','STYLE','LINK'].includes(e.tagName)).map((e) => {
      const s = style(e); return { rect: box(e), style: s, image: options.positionedText && s.backgroundImage ? visual(e, true) : undefined };
    }).filter((e) => e.style.background || e.style.border || e.image),
  })), explicitSlides: slides.length, assets: Array.from(document.querySelectorAll('[data-office-asset]')).map((e) => ({ key: e.getAttribute('data-office-asset')!, ...box(e) })),
    unsupported: Array.from(document.body.querySelectorAll('*')).filter(visible).flatMap((e) => {
      if (e.closest('svg')) return [];
      const s = getComputedStyle(e); const reasons = [];
      if (s.transform !== 'none') reasons.push('transform');
      if (s.boxShadow !== 'none' || s.textShadow !== 'none') reasons.push('shadow');
      if ([getComputedStyle(e, '::before').content, getComputedStyle(e, '::after').content].some((c) => c && !['none', 'normal', '""'].includes(c))) reasons.push('pseudo-element content');
      return reasons.map((reason) => `${e.tagName.toLowerCase()}${e.id ? '#'+e.id : ''}: ${reason}`);
    }),
  };
}

/** Capture an asset's own paint, independently of overlapping page content. */
export function serializeHtmlAsset(key: string) {
  const original = document.querySelector(`[data-office-asset="${key}"]`);
  if (!original) throw new Error(`HTML asset is missing: ${key}`);
  const clone = original.cloneNode(true) as HTMLElement | SVGElement;
  const originals = [original, ...original.querySelectorAll('*')];
  const clones = [clone, ...clone.querySelectorAll('*')];
  originals.forEach((element, index) => {
    const target = clones[index] as HTMLElement | SVGElement;
    const computed = getComputedStyle(element);
    const parentStyle = element.parentElement ? getComputedStyle(element.parentElement) : undefined;
    target.removeAttribute('id');
    for (const name of Array.from(computed)) {
      const value = computed.getPropertyValue(name);
      // Freezing inherited defaults inside SVG definitions overrides the
      // fill/font supplied by <use>, turning gradients and icons black.
      const inherited = /^(?:color|fill(?:-.+)?|stroke(?:-.+)?|font(?:-.+)?|text-.+|visibility|paint-order|clip-rule|marker-.+)$/.test(name);
      if (index && inherited && value === parentStyle?.getPropertyValue(name)) continue;
      target.style.setProperty(name, value.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/g, (match, _quote: string, url: string) => {
        const resolved = new URL(url, document.baseURI);
        return resolved.hash && resolved.href.split('#')[0] === document.URL.split('#')[0] ? `url(${JSON.stringify(resolved.hash)})` : match;
      }));
    }
    if (element instanceof HTMLImageElement) {
      target.setAttribute('src', element.currentSrc || element.src);
      target.removeAttribute('srcset'); target.removeAttribute('sizes'); target.removeAttribute('loading');
    }
  });
  const rect = original.getBoundingClientRect();
  Object.assign(clone.style, { position: 'relative', inset: 'auto', margin: '0', transform: 'none',
    width: `${rect.width}px`, height: `${rect.height}px`, boxSizing: 'border-box' });
  // SVG references can target IDs inside the same asset.
  originals.forEach((element, index) => { if (element.id) clones[index].setAttribute('id', element.id); });
  if (original.hasAttribute('data-office-decoration')) clone.replaceChildren();
  const fonts = Array.from(document.styleSheets).flatMap((sheet) => Array.from(sheet.cssRules))
    .filter((rule) => rule instanceof CSSFontFaceRule).map((rule) => rule.cssText.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/g,
      (_match, _quote: string, url: string) => `url(${JSON.stringify(new URL(url, rule.parentStyleSheet?.href || document.baseURI).href)})`)).join('\n');
  return { html: clone.outerHTML, fonts };
}

/** Print constraints are checked before handing an unusable PDF to the user. */
export function inspectHtmlPrintLayout() {
  const rules: CSSRule[] = [];
  const collect = (items: CSSRuleList) => {
    for (const rule of Array.from(items)) {
      rules.push(rule);
      if (rule instanceof CSSMediaRule && matchMedia(rule.conditionText).matches) collect(rule.cssRules);
    }
  };
  Array.from(document.styleSheets).forEach((sheet) => collect(sheet.cssRules));
  const pageStyle = document.createElement('div').style;
  for (const rule of rules) if (rule instanceof CSSPageRule && !rule.selectorText) {
    for (const name of Array.from(rule.style)) pageStyle.setProperty(name, rule.style.getPropertyValue(name));
  }
  const pixels = (value: string) => {
    const m = value.trim().match(/^([\d.]+)(px|pt|mm|cm|in)?$/i);
    return m ? Number(m[1]) * ({ px: 1, pt: 96 / 72, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 }[m[2]?.toLowerCase() || 'px'] || 1) : undefined;
  };
  const sizes: Record<string, [number, number]> = { a4: [210 * 96 / 25.4, 297 * 96 / 25.4], a3: [297 * 96 / 25.4, 420 * 96 / 25.4], a5: [148 * 96 / 25.4, 210 * 96 / 25.4], letter: [816, 1056], legal: [816, 1344] };
  const size = pageStyle.getPropertyValue('size').toLowerCase().split(/\s+/);
  const physical = size.map(pixels).filter((v): v is number => v !== undefined);
  let [width, height] = sizes[size.find((v) => v in sizes) || 'a4'];
  if (physical.length) [width, height] = [physical[0], physical[1] ?? physical[0]];
  if (size.includes('landscape')) [width, height] = [height, width];
  const usableWidth = width - (pixels(pageStyle.marginLeft) || 0) - (pixels(pageStyle.marginRight) || 0);
  const usableHeight = height - (pixels(pageStyle.marginTop) || 0) - (pixels(pageStyle.marginBottom) || 0);
  const issues: string[] = [];
  for (const element of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
    const s = getComputedStyle(element);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    const typed = element as HTMLElement & { computedStyleMap(): Map<string, { toString(): string }> };
    const fixedHeight = typed.computedStyleMap().get('height')?.toString() !== 'auto';
    const label = element.tagName.toLowerCase() + (element.id ? `#${element.id}` : element.classList.length ? '.' + Array.from(element.classList).join('.') : '');
    if (fixedHeight && (s.breakAfter === 'page' || s.breakBefore === 'page' || s.breakInside.startsWith('avoid')) && element.getBoundingClientRect().height > usableHeight + 2) {
      issues.push(`${label}: fixed page container exceeds printable height (${Math.round(element.getBoundingClientRect().height)} > ${Math.round(usableHeight)}px). Use border-box and a height within @page margins; avoid 100vh plus padding.`);
    }
    if (s.breakBefore === 'page') {
      for (let ancestor = element.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
        if ((ancestor as typeof typed).computedStyleMap().get('height')?.toString() !== 'auto') {
          issues.push(`${label}: forced page break inside a fixed-height container splits its background and content. Reset break-before to auto inside the container.`); break;
        }
      }
    }
  }
  return { width: Math.max(1, Math.round(usableWidth)), height: Math.max(1, Math.round(usableHeight)), issues: [...new Set(issues)] };
}

export type HtmlDocumentModel = ReturnType<typeof collectHtmlDocument>;
export type HtmlBlock = HtmlDocumentModel['blocks'][number];

import type { BrowserChatUIMessagePart } from '@/lib/browser-chat-ui-message';

function restoreCollapsedMarkdownBlocks(value: string) {
  return value
    .replace(/[ \t]+---[ \t]+/g, (match, offset: number, source: string) => {
      const before = source.slice(0, offset).trimEnd();
      const after = source.slice(offset + match.length).trimStart();
      return before.endsWith('|') && after.startsWith('|') ? match : '\n\n---\n\n';
    })
    .replace(/([^\n|#])[ \t]*(?=#{2,6}[ \t]+[^|\n])/g, '$1\n\n')
    .replace(/([^\n|])[ \t]+(?=#[ \t]+[^|\n])/g, '$1\n\n')
    .replace(/^.*\|[ \t]+\|[ \t]*:?-{3,}.*$/gm, (line) => line.replace(/\|[ \t]+\|/g, '|\n|'))
    .replace(/(^|\n)([^\n|]*\S)[ \t]+(?=\|[^\n]+\|\n\|[ \t]*:?-{3,})/g, '$1$2\n\n')
    .replace(/(^|\n)(\*\*[^*\n]{1,120}\*\*)[ \t]*(?=\|[^\n]+\|\n\|[ \t]*:?-{3,})/g, '$1$2\n\n')
    .replace(/(^|\n)(#{1,6}[ \t]+[^|\n]+?)(\|[^\n]+\|)\n(?=\|[ \t]*:?-{3,})/g, '$1$2\n\n$3\n')
    .replace(/\|[ \t]+(?=\*\*[^*\n]{1,80}\*\*[ \t]*[:：])/g, '|\n\n');
}

function pipeRowCells(value: string) {
  // Only repair explicitly enclosed, top-level table rows. Pipes inside
  // prose, lists, blockquotes, or indented code are ordinary content;
  // matching column counts alone do not establish a table.
  if (!/^ {0,3}[|｜].*[|｜][ \t]*$/.test(value)) return undefined;
  const trimmed = value.trim();
  const body = trimmed.replace(/^[|｜]/, '').replace(/[|｜]$/, '');
  const cells: string[] = [];
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] !== '|' && body[index] !== '｜') continue;
    let escapes = 0;
    for (let cursor = index - 1; cursor >= 0 && body[cursor] === '\\'; cursor -= 1) escapes += 1;
    if (escapes % 2) continue;
    cells.push(body.slice(start, index).trim()); start = index + 1;
  }
  cells.push(body.slice(start).trim());
  if (cells.length < 2 || cells.every((cell) => !cell)) return undefined;
  return cells;
}

function isPipeDelimiterRow(cells: string[] | undefined) {
  return Boolean(cells?.length && cells.every((cell) => /^:?-{3,}:?$/.test(cell)));
}

function orderedListHeadersBefore(lines: string[], rowIndex: number, expectedCount: number) {
  const lowerBound = Math.max(0, rowIndex - 30);
  for (let start = rowIndex - 1; start >= lowerBound; start -= 1) {
    if (!/^1[.、)][ \t]+\S/.test(lines[start].trim())) continue;
    const headers: string[] = [];
    for (let cursor = start; cursor < rowIndex; cursor += 1) {
      const match = lines[cursor].trim().match(/^(\d+)[.、)][ \t]+(.+)$/);
      if (!match || Number(match[1]) !== headers.length + 1) break;
      headers.push(match[2].trim());
    }
    if (headers.length === expectedCount) return headers;
  }
  return undefined;
}

function normalizeLoosePipeTables(value: string) {
  const lines = value.split('\n');
  const normalized: string[] = [];
  for (let index = 0; index < lines.length;) {
    const firstCells = pipeRowCells(lines[index]);
    if (!firstCells || isPipeDelimiterRow(firstCells)) {
      normalized.push(lines[index]);
      index += 1;
      continue;
    }
    let delimiterIndex = index + 1;
    while (delimiterIndex < lines.length && !lines[delimiterIndex].trim()) delimiterIndex += 1;
    const delimiterCells = pipeRowCells(lines[delimiterIndex] || '');
    if (delimiterCells?.length === firstCells.length && isPipeDelimiterRow(delimiterCells)) {
      normalized.push(lines[index], lines[delimiterIndex]);
      index = delimiterIndex + 1;
      while (index < lines.length) {
        const cells = pipeRowCells(lines[index]);
        if (!cells || cells.length !== firstCells.length || isPipeDelimiterRow(cells)) break;
        normalized.push(lines[index]);
        index += 1;
      }
      continue;
    }
    const rows: string[][] = [firstCells];
    let cursor = index + 1;
    while (cursor < lines.length) {
      let candidateIndex = cursor;
      while (candidateIndex < lines.length && !lines[candidateIndex].trim()) candidateIndex += 1;
      const cells = candidateIndex < lines.length ? pipeRowCells(lines[candidateIndex]) : undefined;
      if (!cells || cells.length !== firstCells.length || isPipeDelimiterRow(cells)) break;
      rows.push(cells);
      cursor = candidateIndex + 1;
    }
    if (rows.length < 2) {
      normalized.push(lines[index]);
      index += 1;
      continue;
    }
    const inferredHeaders = orderedListHeadersBefore(lines, index, firstCells.length);
    const headers = inferredHeaders || rows[0];
    const bodyRows = inferredHeaders ? rows : rows.slice(1);
    normalized.push(`| ${headers.join(' | ')} |`);
    normalized.push(`| ${headers.map(() => '---').join(' | ')} |`);
    normalized.push(...bodyRows.map((cells) => `| ${cells.join(' | ')} |`));
    index = cursor;
  }
  return normalized.join('\n');
}

function restoreCollapsedNestedLists(value: string) {
  return value.split('\n').map((line) => {
    const item = line.match(/^((?:[ \t]*>[ \t]?)*[ \t]*)([-+*]|\d+[.)])([ \t]+)(\S.*)$/);
    if (!item) return line;
    const [, prefix, marker, spacing, content] = item;
    const separators = [...content.matchAll(/[ \t]+(?=(?:[-+*]|\d+[.)])[ \t]+\S)/g)];
    if (separators.length < 2) return line;
    const children = separators.map((separator, index) => content.slice(
      separator.index! + separator[0].length,
      separators[index + 1]?.index ?? content.length,
    ));
    // Recover only repeated, labelled child items. Ordinary hyphenated prose
    // and arithmetic are ambiguous and must stay unchanged.
    if (!children.every((child) => /^(?:[-+*]|\d+[.)])[ \t]+[^:：\n]+[:：][ \t]*\S/.test(child))) return line;
    const parent = content.slice(0, separators[0].index);
    const childIndent = ' '.repeat(marker.length + spacing.replace(/\t/g, '    ').length);
    return [
      `${prefix}${marker}${spacing}${parent}`,
      ...children.map((child) => `${prefix}${childIndent}${child}`),
    ].join('\n');
  }).join('\n');
}

function normalizeMarkdownSegment(value: string) {
  return normalizeLoosePipeTables(restoreCollapsedMarkdownBlocks(restoreCollapsedNestedLists(value)))
    .replace(/(^|\n)(#{1,6})(?=[^\s#])/g, '$1$2 ')
    .replace(/\\\*\\\*([^\n]+?)\\\*\\\*/g, '**$1**')
    .replace(/\*\*((?:https?:\/\/)[^\s*<>]+)\*\*/gi, '**<$1>**')
    .replace(/\r\n?/g, '\n')
    .replace(/(^|\n)[ \t]*\$\$([^\n]+?)\$\$[ \t]*(?=\n|$)/g, (_match, prefix: string, formula: string) => (
      `${prefix}$$\n${formula.trim()}\n$$`
    ))
    .replace(/([。！？；;])[ \t]+(?=\*\*[^*\n]{1,40}\*\*[ \t]*[:：])/g, '$1\n\n')
    .replace(/([:：。！？；;])[ \t]+-[ \t]+/g, '$1\n- ')
    .replace(/\n{3,}/g, '\n\n');
}

function normalizeFencedCodeBoundaries(value: string) {
  return value
    .replace(/([^\n`])[ \t]*(`{3,}(?!`)(?:[a-z0-9_+-]+)?[ \t]*\n)/gi, '$1\n$2')
    .replace(/([^\n`])[ \t]*(`{3,}(?!`)[ \t]*)(?=\n|$)/g, '$1\n$2')
    .replace(/(^|\n)(```[ \t]*)(?=#{1,6}[ \t]+|---(?:[ \t]|$))/g, '$1$2\n\n');
}

function mapMarkdownProse(value: string, transform: (prose: string) => string) {
  const opening = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/gm;
  const result: string[] = [];
  let offset = 0;
  for (let match = opening.exec(value); match; match = opening.exec(value)) {
    result.push(transform(value.slice(offset, match.index)));
    const fence = match[1];
    const closing = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*(?=\\n|$)`, 'gm');
    closing.lastIndex = opening.lastIndex;
    const end = closing.exec(value);
    offset = end ? end.index + end[0].length : value.length;
    result.push(value.slice(match.index, offset));
    opening.lastIndex = offset;
    if (!end) break;
  }
  result.push(transform(value.slice(offset)));
  return result.join('');
}

type MarkdownAstNode = {
  children?: MarkdownAstNode[];
  type?: string;
  value?: string;
};

function unparsedStrongNodes(value: string) {
  const nodes: MarkdownAstNode[] = [];
  let offset = 0;
  for (const match of value.matchAll(/\*\*([^*\n]+?)\*\*/g)) {
    const index = match.index;
    if (index > offset) nodes.push({ type: 'text', value: value.slice(offset, index) });
    nodes.push({
      type: 'strong',
      children: [{ type: 'text', value: match[1] }],
    });
    offset = index + match[0].length;
  }
  if (!nodes.length) return undefined;
  if (offset < value.length) nodes.push({ type: 'text', value: value.slice(offset) });
  return nodes;
}

function restoreUnparsedStrong(node: MarkdownAstNode) {
  if (!Array.isArray(node.children)) return;
  node.children = node.children.flatMap((child) => {
    if (child.type === 'text' && typeof child.value === 'string') {
      return unparsedStrongNodes(child.value) || [child];
    }
    restoreUnparsedStrong(child);
    return [child];
  });
}

/**
 * CommonMark intentionally leaves some `中文**强调（内容）**中文` delimiter
 * combinations as plain text. Convert only those unresolved text nodes after
 * parsing, while leaving code nodes and already valid Markdown untouched.
 */
export function remarkBrowserChatCjkStrong() {
  return (tree: MarkdownAstNode) => restoreUnparsedStrong(tree);
}

export function normalizeBrowserChatMarkdown(markdown: string) {
  // Inline code belongs to its surrounding block. Normalizing either side
  // separately turns a single table into fragments and invents new headers.
  const normalizeProse = (prose: string) => {
    let marker = '\uE000code';
    while (prose.includes(marker)) marker += '_';
    const code: string[] = [];
    const masked = prose.replace(/(`+)(?!`)([^\n]*?)\1(?!`)/g, (match) => `${marker}${code.push(match) - 1}\uE001`);
    return normalizeMarkdownSegment(masked).replace(new RegExp(`${marker}(\\d+)\uE001`, 'g'), (_match, index: string) => code[Number(index)]);
  };
  return mapMarkdownProse(mapMarkdownProse(markdown.replace(/\r\n?/g, '\n'), normalizeFencedCodeBoundaries), normalizeProse)
    .replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, '');
}

/** Response blocks preserve their array position, including repeated views of one resource. */
export function browserChatOrderedResponseParts(parts: BrowserChatUIMessagePart[] | undefined, fallbackText: string): BrowserChatUIMessagePart[] {
  const response = (parts || []).filter(part => part.type === 'text' || part.type === 'data-response');
  return response.length ? response : [{ type: 'text', text: fallbackText }];
}

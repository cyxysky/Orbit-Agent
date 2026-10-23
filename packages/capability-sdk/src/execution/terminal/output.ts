import { stripVTControlCharacters } from 'node:util';

// Treat VT sequences as indivisible, zero-width spans. Cursor offsets always
// refer to the retained raw stream, never to the stripped or paginated text.
const controls = () => /(?:\x1b\]|\x9d)[\s\S]*?(?:\x07|\x1b\\|\x9c)|(?:\x1b[P^_X]|[\x90\x98\x9e\x9f])[\s\S]*?(?:\x1b\\|\x9c)|(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]|\x1b[ -/]*[0-~]/g;

export const plainTerminalOutput = (raw: string) => stripVTControlCharacters(raw.replace(controls(), ''));
export type TerminalOutputOptions = { maxOutputChars?: number; outputMode?: 'head' | 'tail' };

const high = (code: number) => code >= 0xd800 && code <= 0xdbff;
const low = (code: number) => code >= 0xdc00 && code <= 0xdfff;
const boundary = (text: string, offset: number, direction: -1 | 1) =>
  offset > 0 && offset < text.length && high(text.charCodeAt(offset - 1)) && low(text.charCodeAt(offset)) ? offset + direction : offset;

export function terminalOutputPage(raw: string, startCursor: number, requestedCursor: number, options: TerminalOutputOptions) {
  const endCursor = startCursor + raw.length;
  let start = boundary(raw, Math.max(0, Math.min(raw.length, requestedCursor - startCursor)), 1);
  const spans: Array<{ start: number; end: number }> = [];
  let position = 0;
  for (const match of raw.matchAll(controls())) {
    const end = match.index + match[0].length;
    if (start > match.index && start < end) start = end;
    if (match.index > position) spans.push({ start: position, end: match.index });
    position = end;
  }
  if (position < raw.length) spans.push({ start: position, end: raw.length });
  const visible = spans.filter(span => span.end > start).map(span => ({ start: Math.max(start, span.start), end: span.end }));
  const limit = options.maxOutputChars ?? 8000;
  let remaining = limit, output = '', next = raw.length, outputStart = start, omittedChars = 0;
  if (options.outputMode === 'tail') {
    outputStart = raw.length;
    for (let i = visible.length - 1; i >= 0; i--) {
      const span = visible[i];
      const cut = boundary(raw, Math.max(span.start, span.end - remaining), 1);
      output = raw.slice(cut, span.end) + output;
      remaining -= span.end - cut;
      outputStart = cut;
      if (cut > span.start || remaining === 0) {
        omittedChars = cut - span.start + visible.slice(0, i).reduce((sum, item) => sum + item.end - item.start, 0);
        break;
      }
    }
  } else {
    for (const span of visible) {
      const end = boundary(raw, Math.min(span.end, span.start + remaining), -1);
      output += raw.slice(span.start, end);
      remaining -= end - span.start;
      if (end < span.end) { next = end; break; }
    }
  }
  return { output, outputStartCursor: startCursor + outputStart, cursor: startCursor + next, endCursor,
    hasMore: next < raw.length, truncated: requestedCursor < startCursor, ...(omittedChars ? { omittedChars } : {}) };
}

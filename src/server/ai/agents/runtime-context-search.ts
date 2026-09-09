import type { ModelMessage } from 'ai';

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function parsed(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

/** Shared by search and exact reads so every returned pointer/offset is reproducible. */
export function runtimeContextMaterialValue(message: ModelMessage): unknown {
  if (message.role !== 'tool') return message;
  const results = message.content.map((part) => {
    if (part.type !== 'tool-result') return part;
    const value = 'value' in part.output ? parsed(part.output.value) : part.output;
    const envelope = object(value);
    return envelope && 'actual' in envelope ? { ...envelope, actual: parsed(envelope.actual) } : value;
  });
  return results.length === 1 ? results[0] : results;
}

type Section = { pointer: string; text: string };
type Chunk = Section & { ref: string; role: string; start: number; terms: Map<string, number>; length: number };
const segmenter = new Intl.Segmenter('und', { granularity: 'word' });
function tokens(text: string) {
  const normalized = text.normalize('NFKC').toLowerCase();
  // Preserve identifiers while also matching individual path/code components.
  const words = normalized.match(/[\p{L}\p{N}_]+/gu) || [];
  return words.flatMap((word) => /[^\x00-\x7f]/.test(word)
    ? [...segmenter.segment(word)].filter((part) => part.isWordLike).map((part) => part.segment)
    : word.split('_').filter(Boolean));
}
function sections(value: unknown, pointer = ''): Section[] {
  if (typeof value === 'string') return [{ pointer, text: value }];
  const record = object(value);
  // Arrays remain one exact JSON value, avoiding an index entry for every scalar/table cell.
  if (!record) return [{ pointer, text: JSON.stringify(value) ?? '' }];
  return Object.entries(record).flatMap(([key, child]) => sections(child, `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`));
}

function searchable(message: ModelMessage) {
  if (message.role === 'system') return false;
  if (message.role === 'user' && typeof message.content === 'string'
    && /^\[(?:Conversation background|WebPilot (?:task state|material reference|knowledge context|continuation)|Binary visual input omitted|Document visual QA|Attachment visual content|Explicit visual evidence|Browser observation)/.test(message.content)) return false;
  if (message.role === 'tool') return message.content.some((part) => {
    if (part.type !== 'tool-result' || part.toolName === 'contextRead') return false;
    const value = object('value' in part.output ? parsed(part.output.value) : undefined);
    return !((value?.archived === true && typeof value.contextRef === 'string') || (value?.historical === true && value?.complete === false && typeof value?.ref === 'string'));
  });
  return true;
}

function messageSections(message: ModelMessage): Section[] {
  if (message.role === 'tool') {
    const value = runtimeContextMaterialValue(message);
    return message.content.flatMap((part, index) => {
      if (part.type !== 'tool-result' || part.toolName === 'contextRead') return [];
      const result = message.content.length === 1 ? value : (value as unknown[])[index];
      const envelope = object(result);
      if ((envelope?.archived === true && typeof envelope.contextRef === 'string') || (envelope?.historical === true && envelope?.complete === false && typeof envelope?.ref === 'string')) return [];
      return sections(result, message.content.length === 1 ? '' : `/${index}`);
    });
  }
  if (typeof message.content === 'string') return sections(message.content, '/content');
  return message.content.flatMap((part, index) => {
    if (part.type === 'text') return sections(part.text, `/content/${index}/text`);
    if (part.type === 'tool-call' && part.toolName !== 'contextRead') return sections(part.input, `/content/${index}/input`);
    // Binary inputs and provider reasoning/signatures are not a text search corpus.
    return [];
  });
}

/** Derived index only. Durable, session-scoped ctx_ records remain the source of truth. */
class ContextSearchIndex {
  private documents = new Map<string, { message: ModelMessage; chunks: Chunk[] }>();
  private postings = new Map<string, Map<Chunk, number>>();
  private totalLength = 0;
  private totalChunks = 0;

  sync(records: Record<string, ModelMessage>) {
    for (const [ref, document] of this.documents) if (!Object.hasOwn(records, ref)) {
      for (const chunk of document.chunks) {
        this.totalChunks--; this.totalLength -= chunk.length;
        for (const term of chunk.terms.keys()) {
          const posting = this.postings.get(term)!;
          posting.delete(chunk);
          if (!posting.size) this.postings.delete(term);
        }
      }
      this.documents.delete(ref);
    }
    for (const [ref, message] of Object.entries(records)) {
      // References are content-addressed immutable records; rehydration can replace object identity.
      if (this.documents.has(ref)) continue;
      const chunks: Chunk[] = [];
      this.documents.set(ref, { message, chunks });
      if (!searchable(message)) continue;
      for (const section of messageSections(message)) {
        // Large strings split at newline boundaries with overlap; exact text stays untouched.
        for (let start = 0; start < section.text.length;) {
          let end = Math.min(section.text.length, start + 1800);
          if (end < section.text.length) {
            const newline = section.text.lastIndexOf('\n', end);
            if (newline > start + 900) end = newline + 1;
          }
          const text = section.text.slice(start, end);
          const words = tokens(`${section.pointer} ${text}`);
          const terms = new Map<string, number>();
          for (const term of words) terms.set(term, (terms.get(term) || 0) + 1);
          const chunk: Chunk = { ref, role: message.role, pointer: section.pointer, text, start, terms, length: Math.max(1, words.length) };
          chunks.push(chunk); this.totalChunks++; this.totalLength += chunk.length;
          for (const [term, count] of terms) {
            const posting = this.postings.get(term) || new Map<Chunk, number>();
            posting.set(chunk, count); this.postings.set(term, posting);
          }
          if (end === section.text.length) break;
          start = end - 100;
        }
      }
    }
  }

  search(query: string, offset: number, limit: number) {
    const terms = [...new Set(tokens(query))].slice(0, 64);
    const scores = new Map<Chunk, { score: number; matched: number }>();
    const averageLength = this.totalLength / Math.max(1, this.totalChunks);
    for (const term of terms) {
      const posting = this.postings.get(term);
      if (!posting) continue;
      const idf = Math.log(1 + (this.totalChunks - posting.size + 0.5) / (posting.size + 0.5));
      for (const [chunk, count] of posting) {
        const previous = scores.get(chunk) || { score: 0, matched: 0 };
        previous.score += idf * count * 2.2 / (count + 1.2 * (0.25 + 0.75 * chunk.length / averageLength));
        previous.matched++;
        scores.set(chunk, previous);
      }
    }
    const ranked = [...scores].sort(([a, x], [b, y]) => y.matched - x.matched || y.score - x.score || a.ref.localeCompare(b.ref) || a.start - b.start);
    // Multiple overlapping chunks can describe the same hit. Keep distinct regions.
    const unique: Array<[Chunk, { score: number; matched: number }]> = [];
    const regions = new Map<string, number[]>();
    for (const entry of ranked) {
      const chunk = entry[0];
      const key = `${chunk.ref}:${chunk.pointer}`;
      const starts = regions.get(key) || [];
      if (starts.some((start) => Math.abs(start - chunk.start) < 900)) continue;
      starts.push(chunk.start); regions.set(key, starts); unique.push(entry);
    }
    const records = [];
    let remaining = limit;
    for (const [chunk, rank] of unique.slice(offset, offset + 10)) {
      if (remaining <= 0) break;
      const length = Math.min(1000, remaining, chunk.text.length);
      const lowered = chunk.text.toLowerCase();
      const hits = terms.map((term) => lowered.indexOf(term)).filter((position) => position >= 0);
      const begin = Math.max(0, Math.min(chunk.text.length - length, (hits.length ? Math.min(...hits) : 0) - 160));
      const content = chunk.text.slice(begin, begin + length);
      records.push({ ref: chunk.ref, role: chunk.role, pointer: chunk.pointer, offset: chunk.start + begin,
        content, complete: false, score: Number(rank.score.toFixed(4)), matchedTerms: rank.matched });
      remaining -= content.length;
    }
    return { ok: true, historical: true, complete: false, query, total: unique.length, records,
      nextOffset: offset + records.length < unique.length ? offset + records.length : null,
      instruction: 'Ranked historical excerpts, not complete reads or current state. Read a hit with ref, pointer and character offset; omit query for an exact read. Search pagination offset counts hits.' };
  }
}

const indexes = new WeakMap<Record<string, ModelMessage>, ContextSearchIndex>();
export function searchRuntimeContextRecords(records: Record<string, ModelMessage>, query: string, offset: number, limit: number) {
  let index = indexes.get(records);
  if (!index) { index = new ContextSearchIndex(); indexes.set(records, index); }
  index.sync(records);
  return index.search(query, offset, limit);
}

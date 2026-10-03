import { z } from 'zod';

export const novelEditSchema = z.object({
  op: z.enum(['replace', 'add', 'remove']),
  path: z.string().min(1).describe('JSON Pointer into /plan or an existing /chapters/0/content, title, summary or continuity. Array indexes are zero-based. Use /plan/chapters/- to append an outline entry.'),
  value: z.unknown().optional().describe('Replacement value; required for add/replace, omitted for remove.'),
}).superRefine((edit, ctx) => {
  if (edit.op !== 'remove' && edit.value === undefined) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Supply value for add/replace.' });
});
export type NovelEdit = z.infer<typeof novelEditSchema>;

export type NovelContentChange = {
  path: string; beforeExists: boolean; afterExists: boolean; before?: unknown; after?: unknown;
};
/** Describe canonical saved content, not the model's unvalidated patch input. */
export function novelContentChanges(before: unknown, after: unknown, path = ''): NovelContentChange[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (before && after && typeof before === 'object' && typeof after === 'object'
    && Array.isArray(before) === Array.isArray(after)) {
    const old = before as Record<string, unknown>, next = after as Record<string, unknown>;
    return [...new Set([...Object.keys(old), ...Object.keys(next)])].flatMap(key =>
      novelContentChanges(old[key], next[key], `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`));
  }
  return [{ path, beforeExists: before !== undefined, afterExists: after !== undefined,
    ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}) }];
}

/** Apply atomically to a detached JSON document; never mutate the stored entity. */
export function applyNovelEdits<T>(document: T, edits: NovelEdit[]): T {
  const result = structuredClone(document);
  for (const edit of edits) {
    const parts = edit.path.split('/').slice(1).map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (!edit.path.startsWith('/') || parts.some(part => ['__proto__', 'prototype', 'constructor'].includes(part))
      || !(parts[0] === 'plan' || (parts[0] === 'chapters' && /^(0|[1-9]\d*)$/.test(parts[1] || '')
        && parts.length === 3 && ['title', 'content', 'summary', 'continuity'].includes(parts[2])))) {
      throw new Error(`Invalid novel edit path: ${edit.path}`);
    }
    let parent: unknown = result;
    for (const part of parts.slice(0, -1)) {
      if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, part)) throw new Error(`Novel edit target not found: ${edit.path}`);
      parent = (parent as Record<string, unknown>)[part];
    }
    const key = parts.at(-1)!;
    if (!parent || typeof parent !== 'object') throw new Error(`Novel edit target not found: ${edit.path}`);
    if (Array.isArray(parent)) {
      const index = key === '-' && edit.op === 'add' ? parent.length : /^(0|[1-9]\d*)$/.test(key) ? Number(key) : -1;
      if (index < 0 || index > parent.length || (edit.op !== 'add' && index === parent.length)) throw new Error(`Invalid novel array index: ${edit.path}`);
      if (edit.op === 'add') parent.splice(index, 0, structuredClone(edit.value));
      else if (edit.op === 'remove') parent.splice(index, 1);
      else parent[index] = structuredClone(edit.value);
    } else {
      const object = parent as Record<string, unknown>;
      if (edit.op !== 'add' && !Object.hasOwn(object, key)) throw new Error(`Novel edit target not found: ${edit.path}`);
      if (edit.op === 'remove') delete object[key];
      else object[key] = structuredClone(edit.value);
    }
  }
  return result;
}

import { fromMarkdown } from 'mdast-util-from-markdown';

export type BrowserChatMarkdownSnapshot = { markdown: string; blocks: string[] };

function independentBlocks(markdown: string): string[] | undefined {
  if (/\${2,}|^ {0,3}\[[^\]\n]+\]:/m.test(markdown)) return undefined;
  const tree = fromMarkdown(markdown);
  const pending = [...tree.children];
  while (pending.length) {
    const node = pending.pop()!;
    // Raw HTML can span Markdown blocks; definitions resolve references in
    // other blocks, including references that arrived earlier in the stream.
    if (node.type === 'html' || node.type === 'definition') return undefined;
    if ('children' in node) pending.push(...node.children);
  }
  return tree.children.length ? tree.children.map((node, index) => markdown.slice(
    node.position!.start.offset!,
    tree.children[index + 1]?.position?.start.offset ?? markdown.length,
  )) : [markdown];
}

/** Completed blocks stay stable; only the open tail needs parsing.
 * Late references, raw HTML and display math still invalidate the document. */
export function browserChatMarkdownBlocks(markdown: string, previous?: BrowserChatMarkdownSnapshot): string[] {
  // Keep the same block identities from the first chunk. Switching from one
  // document to many blocks at a length threshold remounts already-visible DOM.
  if (previous && previous.blocks.length > 1 && markdown.startsWith(previous.markdown)) {
    const stable = previous.blocks.slice(0, -1);
    const prefix = stable.join('');
    if (previous.markdown.startsWith(prefix)) {
      const tail = independentBlocks(markdown.slice(prefix.length));
      return tail ? [...stable, ...tail] : [markdown];
    }
  }
  return independentBlocks(markdown) || [markdown];
}

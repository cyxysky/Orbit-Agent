import { fromMarkdown } from 'mdast-util-from-markdown';

/** Split only independent blocks; document-wide syntax stays in one renderer. */
export function browserChatMarkdownBlocks(markdown: string): string[] {
  if (markdown.length < 4_096 || /\${2,}|^ {0,3}\[[^\]\n]+\]:/m.test(markdown)) return [markdown];
  const tree = fromMarkdown(markdown);
  const pending = [...tree.children];
  while (pending.length) {
    const node = pending.pop()!;
    // Raw HTML can span Markdown blocks; definitions resolve references in
    // other blocks, including references that arrived earlier in the stream.
    if (node.type === 'html' || node.type === 'definition') return [markdown];
    if ('children' in node) pending.push(...node.children);
  }
  return tree.children.length ? tree.children.map((node, index) => markdown.slice(
    node.position!.start.offset!,
    tree.children[index + 1]?.position?.start.offset ?? markdown.length,
  )) : [markdown];
}

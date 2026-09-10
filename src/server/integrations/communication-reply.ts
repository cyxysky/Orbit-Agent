import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Root, RootContent } from 'mdast';
import type { CommunicationContent } from '@webpilot/capability-communication';
import { artifactContentType } from '@webpilot/capability-file';
import { browserChatArtifactIdFromUrl } from '@/lib/browser-chat-artifacts';
import type { BrowserChatMessage } from '@/server/ai/agents/browser-chat.service';

export function splitCommunicationText(value: string, limit = 18_000) {
  const chunks: string[] = [];
  let chunk = '';
  let bytes = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > limit) { chunks.push(chunk); chunk = ''; bytes = 0; }
    chunk += character; bytes += size;
  }
  if (chunk.trim()) chunks.push(chunk);
  return chunks;
}

/** Keep rendered text and deliver output files as typed media, never as localhost links. */
export function communicationReplyContents(message: BrowserChatMessage): CommunicationContent[] {
  const source = message.content || message.parts?.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n\n') || '';
  const tree = fromMarkdown(source);
  const definitions = new Map<string, string>();
  const walk = (node: Root | RootContent, visit: (node: Root | RootContent) => void) => {
    visit(node);
    if ('children' in node) for (const child of node.children) walk(child, visit);
  };
  walk(tree, node => { if (node.type === 'definition') definitions.set(node.identifier, node.url); });
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  const remove = (node: RootContent, text = '') => {
    const start = node.position?.start.offset, end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) replacements.push({ start, end, text });
  };
  walk(tree, node => {
    if (node.type === 'image' || node.type === 'imageReference') remove(node);
    if (node.type === 'link' || node.type === 'linkReference') {
      const url = node.type === 'link' ? node.url : definitions.get(node.identifier) || '';
      if (browserChatArtifactIdFromUrl(url) || url.startsWith('attachment://')) {
        remove(node, node.children.flatMap(child => child.type === 'text' ? [child.value] : []).join(''));
      }
    }
    if (node.type === 'definition' && (browserChatArtifactIdFromUrl(node.url) || node.url.startsWith('attachment://'))) remove(node);
    if (node.type === 'html' && /<img\b/i.test(node.value)) remove(node);
  });
  let text = source;
  // Parent replacements take precedence over contained nodes.
  const outer = replacements.filter(item => !replacements.some(other => other !== item && other.start <= item.start && other.end >= item.end));
  for (const item of outer.sort((a, b) => b.start - a.start)) text = text.slice(0, item.start) + item.text + text.slice(item.end);
  text = text.replace(/(?:https?:\/\/[^\s<>/]+)?(?:\/[^\s<>/]+)*\/api\/artifacts\/[^\s<>]+/g, '');
  const files = new Map<string, CommunicationContent>();
  for (const artifact of message.artifacts || []) {
    if (artifact.kind === 'screenshot') continue;
    const artifactId = browserChatArtifactIdFromUrl(artifact.url || '') || browserChatArtifactIdFromUrl(artifact.downloadUrl || '')
      || (artifact.id.startsWith('file:') ? artifact.id.slice(5) : artifact.id);
    if (!artifactId || artifactId.includes('attachment-previews/')) continue;
    const mime = artifactContentType(artifact.fileName);
    const format = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime === 'audio/amr' ? 'voice' : 'file';
    files.set(artifactId, { format, artifactId });
  }
  if (replacements.length && ![...files.values()].some(content => content.format === 'image') && /!\[|<img\b/i.test(source)) {
    text += '\n\n回复中的图片没有对应的可发送产物，请在网页查看；未将图片链接当作已发送的图片。';
  }
  if (!text.trim() && !files.size) {
    text = message.status === 'failed' ? '本轮生成失败，请在网页对话中查看详情。'
      : message.status === 'interrupted' ? '本轮处理已停止。'
        : '本轮已完成，详细内容可在网页对话中查看。';
  }
  if (message.parts?.some(part => part.type === 'data-chart' || part.type === 'data-map' || part.type === 'data-ui')) text += '\n\n交互地图、图表和卡片请在网页对话中查看。';
  return [...splitCommunicationText(text.trim()).map(body => ({ format: 'markdown' as const, body })), ...files.values()];
}

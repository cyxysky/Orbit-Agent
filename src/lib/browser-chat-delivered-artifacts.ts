import { fromMarkdown } from 'mdast-util-from-markdown';
import { fromHtml } from 'hast-util-from-html';
import { jsonRecordFromUnknown } from '@cjfclonedeep/capability-sdk';
import { responseRegistry } from './response-registry';
import {
  browserChatArtifactDownloadUrl, browserChatArtifactIdFromUrl, browserChatArtifactKey,
  browserChatArtifactOpenUrl, mergeBrowserChatArtifactSummaries, resolveBrowserChatArtifactReference,
  type BrowserChatArtifactSummary,
} from './browser-chat-artifacts';

type ReferenceNode = {
  type: string; value?: string; url?: string; identifier?: string; tagName?: string;
  properties?: Record<string, unknown>; children?: ReferenceNode[];
};
type ArtifactMessage = {
  role?: string; status?: string; content?: string; parts?: readonly unknown[];
  artifacts?: readonly BrowserChatArtifactSummary[];
};

/** Tool receipts are candidates. Only references in the committed answer deliver them. */
export function browserChatDeliveredArtifacts(message: ArtifactMessage): BrowserChatArtifactSummary[] {
  if (message.role !== 'assistant' || message.status === 'running' || message.status === 'queued') return [];
  const candidates = mergeBrowserChatArtifactSummaries(message.artifacts);
  if (!candidates.length) return [];
  const references: string[] = [];
  const bareReferences = (text: string) => {
    for (const match of text.matchAll(/attachment:\/\/[^\s<>"'`\[\]，。；！？、（）【】]+|(?:https?:\/\/[^\s/<>"']+)?(?:\/[a-zA-Z0-9._~-]+)*\/api\/artifacts\/[^\s<>"'`\[\]，。；！？、（）【】]+/gu)) {
      let value = match[0].replace(/[.,;:!?}]+$/u, '');
      while (value.endsWith(')') && (value.match(/\)/g)?.length || 0) > (value.match(/\(/g)?.length || 0)) value = value.slice(0, -1);
      references.push(value);
    }
  };
  const htmlReferences = (html: string) => {
    const visit = (node: ReferenceNode) => {
      if (['script', 'style', 'pre', 'code'].includes(node.tagName || '')) return;
      const target = node.tagName === 'a' ? node.properties?.href : node.tagName === 'img' ? node.properties?.src : undefined;
      if (typeof target === 'string') { references.push(target); return; }
      if (node.type === 'text' && node.value) bareReferences(node.value);
      node.children?.forEach(visit);
    };
    visit(fromHtml(html, { fragment: true }));
  };
  const markdownReferences = (text: string) => {
    const root = fromMarkdown(text);
    const definitions = new Map<string, string>();
    const readDefinitions = (node: ReferenceNode) => {
      if (node.type === 'definition' && node.identifier && node.url && !definitions.has(node.identifier.toUpperCase())) definitions.set(node.identifier.toUpperCase(), node.url);
      node.children?.forEach(readDefinitions);
    };
    readDefinitions(root);
    const visit = (node: ReferenceNode) => {
      if (['code', 'inlineCode', 'definition'].includes(node.type)) return;
      if ((node.type === 'link' || node.type === 'image') && node.url) { references.push(node.url); return; }
      if ((node.type === 'linkReference' || node.type === 'imageReference') && node.identifier) {
        const url = definitions.get(node.identifier.toUpperCase()); if (url) references.push(url);
        return;
      }
      if (node.type === 'html' && node.value) htmlReferences(node.value);
      if (node.type === 'text' && node.value) bareReferences(node.value);
      node.children?.forEach(visit);
    };
    visit(root);
  };
  const uiReferences = (node: unknown) => {
    const record = jsonRecordFromUnknown(node), props = jsonRecordFromUnknown(record?.props);
    if (record?.type === 'link' && typeof props?.href === 'string') references.push(props.href);
    if (Array.isArray(record?.children)) record.children.forEach(uiReferences);
  };
  const parts = (message.parts || []).flatMap(value => {
    const part = jsonRecordFromUnknown(value);
    return part && (part.type === 'text' || part.type === 'data-response') ? [part] : [];
  });
  if (!parts.length) markdownReferences(message.content || '');
  for (const part of parts) {
    if (part.type === 'text' && typeof part.text === 'string') markdownReferences(part.text);
    if (part.type !== 'data-response') continue;
    const block = jsonRecordFromUnknown(part.data), params = jsonRecordFromUnknown(block?.params);
    if (!block || !params || typeof block.type !== 'string') continue;
    markdownReferences(responseRegistry.toText({ type: block.type, params }));
    if (block.type === 'core.html' && typeof params.html === 'string') htmlReferences(params.html);
    if (block.type === 'core.ui') uiReferences(params.tree);
  }
  const delivered = new Map<string, BrowserChatArtifactSummary>();
  for (const reference of references) {
    const target = resolveBrowserChatArtifactReference(reference, candidates, true);
    if (!target) continue;
    const id = browserChatArtifactIdFromUrl(target);
    const artifact = candidates.find(candidate => {
      const open = browserChatArtifactOpenUrl(candidate), download = browserChatArtifactDownloadUrl(candidate);
      return target === open || target === download || Boolean(id && [open, download].some(url => url && browserChatArtifactIdFromUrl(url) === id));
    });
    if (artifact && browserChatArtifactOpenUrl(artifact)) delivered.set(browserChatArtifactKey(artifact), artifact);
  }
  return [...delivered.values()];
}

import { jsonRecordFromUnknown, jsonValueFromString } from '@webpilot/capability-sdk';
import type { StepExecutionResult, StepToolCall } from '@/server/ai/schemas/runtime.schema';

export type BrowserChatArtifactSummary = {
  bytes?: number;
  documentId?: string;
  downloadUrl?: string;
  fileName: string;
  id: string;
  kind: 'file' | 'image' | 'screenshot';
  pageCount?: number;
  path?: string;
  title?: string;
  url?: string;
};

/** Resolve model attachment aliases only against artifacts actually delivered in this message. */
export function resolveBrowserChatArtifactReference(
  value: string,
  artifacts: readonly BrowserChatArtifactSummary[],
  image = false,
) {
  if (!/^attachment:\/\//i.test(value)) return value;
  let reference: string;
  try { reference = decodeURIComponent(value.slice('attachment://'.length)); } catch { return ''; }
  const matches = artifacts.filter((artifact) => (
    artifact.fileName === reference || artifact.id === reference
    || artifact.id === `file:${reference}` || artifact.path === reference
  ));
  if (matches.length !== 1) return '';
  const artifact = matches[0];
  const url = image ? artifact.url || artifact.downloadUrl : artifact.downloadUrl || artifact.url;
  return image ? (url || '').replace(/([?&])download=1(&|$)/, '$1').replace(/[?&]$/, '') : url || '';
}

/** Consume the shared artifact contract regardless of which tool produced it. */
export function browserChatArtifactPayloads(value: unknown): Record<string, unknown>[] {
  const payload = jsonRecordFromUnknown(value) || jsonRecordFromUnknown(jsonValueFromString(value));
  if (!payload) return [];
  const candidates = [payload, ...(Array.isArray(payload.data) ? payload.data : []),
    ...(Array.isArray(payload.content) ? payload.content.filter((item) => jsonRecordFromUnknown(item)?.type === 'artifact') : [])];
  const seen = new Set<string>();
  return candidates.flatMap((value) => {
    const item = jsonRecordFromUnknown(value);
    if (!item) return [];
    if (!item.artifactId && !item.downloadUrl && !(item.fileName && (item.path || item.url))) return [];
    const id = String(item.artifactId || item.path || item.url || item.downloadUrl || '');
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [item];
  });
}

export function browserChatScreenshotIsInternalDocumentPreview(
  screenshot: { path?: string; title?: string },
) {
  const path = String(screenshot.path || '').replace(/\\/g, '/');
  return /(?:^|\/)attachment-previews(?:\/|$)/i.test(path);
}

export function browserChatArtifactFileName(value: unknown) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().replace(/\\/g, '/');
  if (!normalized) return '';
  const fileName = normalized.split('/').pop() || '';
  try {
    return decodeURIComponent(fileName);
  } catch {
    return fileName;
  }
}

export function browserChatArtifactExtension(fileName: string) {
  return fileName.match(/\.([a-z0-9]{1,10})$/i)?.[1]?.toUpperCase();
}

export function browserChatArtifactIsImage(fileName: string) {
  return /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(fileName);
}

function browserChatFileArtifacts(tool: StepToolCall): BrowserChatArtifactSummary[] {
  const rawResult = jsonRecordFromUnknown(tool.rawResult);
  if (rawResult?.ok !== true) return [];
  return browserChatArtifactPayloads(rawResult.actual ?? rawResult).flatMap((payload): BrowserChatArtifactSummary[] => {

    const artifactId = typeof payload.artifactId === 'string' ? payload.artifactId.trim() : '';
    const path = typeof payload.path === 'string' ? payload.path.trim() : '';
    const url = typeof payload.url === 'string' ? payload.url.trim() : '';
    const downloadUrl = typeof payload.downloadUrl === 'string' ? payload.downloadUrl.trim() : '';
    const documentId = typeof payload.documentId === 'string' ? payload.documentId.trim() : '';
    if (!artifactId && !path && !url && !downloadUrl) return [];

    const visualVerification = jsonRecordFromUnknown(payload.visualVerification);
    const bytes = typeof payload.bytes === 'number' && Number.isFinite(payload.bytes) && payload.bytes >= 0
      ? payload.bytes
      : undefined;
    const pageCount = typeof visualVerification?.pageCount === 'number'
      && Number.isFinite(visualVerification.pageCount)
      && visualVerification.pageCount > 0
      ? Math.floor(visualVerification.pageCount)
      : undefined;
    const fileName = browserChatArtifactFileName(payload.fileName)
      || browserChatArtifactFileName(path)
      || browserChatArtifactFileName(artifactId)
      || 'artifact';
    return [{
      bytes,
      documentId: documentId || undefined,
      downloadUrl: downloadUrl || undefined,
      fileName,
      id: documentId
        ? `file:document:${documentId}`
        : `file:${artifactId || path || url || downloadUrl}`,
      kind: browserChatArtifactIsImage(fileName) ? 'image' : 'file',
      pageCount,
      path: path || undefined,
      url: url || (downloadUrl ? downloadUrl.replace(/([?&])download=1(&|$)/, '$1').replace(/[?&]$/, '') : undefined),
    }];
  });
}

export function browserChatArtifactsFromTool(tool: StepToolCall) {
  const artifacts: BrowserChatArtifactSummary[] = [];
  artifacts.push(...browserChatFileArtifacts(tool));
  for (const screenshot of tool.screenshots || []) {
    if (browserChatScreenshotIsInternalDocumentPreview(screenshot)) continue;
    const path = screenshot.path?.trim();
    if (!path) continue;
    artifacts.push({
      fileName: browserChatArtifactFileName(path) || 'screenshot.png',
      id: `screenshot:${path}`,
      kind: 'screenshot',
      path,
      title: screenshot.title?.trim() || '截图',
    });
  }
  return artifacts;
}

export function mergeBrowserChatArtifactSummaries(
  ...groups: ReadonlyArray<readonly BrowserChatArtifactSummary[] | undefined>
) {
  const byId = new Map<string, BrowserChatArtifactSummary>();
  for (const artifact of groups.flatMap((group) => group || [])) {
    if (
      artifact.kind === 'screenshot'
      && browserChatScreenshotIsInternalDocumentPreview(artifact)
    ) continue;
    const previous = byId.get(artifact.id);
    byId.set(artifact.id, previous ? { ...previous, ...artifact } : artifact);
  }
  return [...byId.values()];
}

export function browserChatArtifactsFromSteps(steps: readonly StepExecutionResult[]) {
  return mergeBrowserChatArtifactSummaries(
    steps.flatMap((step) => (step.tools || []).flatMap(browserChatArtifactsFromTool)),
  );
}

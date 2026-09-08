import { browserChatArtifactIdFromUrl, browserChatArtifactIsImage, browserChatArtifactPayloads, resolveBrowserChatArtifactReference, type BrowserChatArtifactSummary } from '@/lib/browser-chat-artifacts';

type FileArtifactToolResult = {
  name: string;
  result?: unknown;
};

type FileArtifactDownload = {
  artifactId: string;
  downloadUrl: string;
  fileName: string;
  url?: string;
  mediaType?: string;
};

type ArtifactDownloadPayload = {
  artifactId?: string;
  downloadUrl?: string;
  fileName?: string;
  url?: string;
  mediaType?: string;
};

function verifiedArtifactDownloadUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value, 'http://webpilot.local');
    if (!url.pathname.includes('/api/artifacts/') || url.searchParams.get('download') !== '1') return undefined;
    return value.trim();
  } catch {
    return undefined;
  }
}

function fileArtifactDownloadsFromToolResult(tool: FileArtifactToolResult): FileArtifactDownload[] {
  if (!tool.result || typeof tool.result !== 'object' || !('ok' in tool.result) || tool.result.ok !== true) return [];
  try {
    const actual = 'actual' in tool.result ? tool.result.actual : tool.result;
    return browserChatArtifactPayloads(actual).flatMap((payload: ArtifactDownloadPayload) => {
      const artifactId = String(payload.artifactId || '').trim();
      const fileName = String(payload.fileName || '').trim();
      const downloadUrl = verifiedArtifactDownloadUrl(payload.downloadUrl);
      if (
        !artifactId
        || !fileName
        || !downloadUrl
        || artifactId.split('/').some((segment) => !segment || segment === '.' || segment === '..')
      ) return [];
      return [{ artifactId, downloadUrl, fileName, url: payload.url, mediaType: payload.mediaType }];
    });
  } catch {
    return [];
  }
}

function artifactMarkdownUrl(value: string) {
  try {
    const url = new URL(value, 'http://webpilot.local');
    return url.pathname.includes('/api/artifacts/');
  } catch {
    return false;
  }
}

function normalizedMarkdownLinkLabel(value: string) {
  return value
    .replace(/\\([\[\]\\])/g, '$1')
    .replace(/[*_`]/g, '')
    .trim();
}

function repairArtifactDownloadLinks(reply: string, downloads: FileArtifactDownload[]) {
  if (!downloads.length) return reply;
  const artifacts: BrowserChatArtifactSummary[] = downloads.map((item) => ({
    id: `file:${item.artifactId}`, fileName: item.fileName,
    kind: item.mediaType?.startsWith('image/') || browserChatArtifactIsImage(item.fileName) ? 'image' : 'file',
    url: item.url, downloadUrl: item.downloadUrl,
  }));
  return reply.replace(/(!?)\[([^\]\r\n]*)\]\(([^)\s]+)([^)\r\n]*)\)/g, (full, imagePrefix, label, href, suffix) => {
    const resolved = resolveBrowserChatArtifactReference(href, artifacts, Boolean(imagePrefix));
    if (resolved && resolved !== href) return `${imagePrefix}[${label}](${resolved}${suffix})`;
    if (imagePrefix || !artifactMarkdownUrl(href)) return full;
    const normalizedLabel = normalizedMarkdownLinkLabel(label);
    const exactUrl = downloads.find((item) => item.downloadUrl === href);
    const hrefArtifactId = browserChatArtifactIdFromUrl(href);
    const exactArtifact = hrefArtifactId
      ? downloads.find((item) => item.artifactId === hrefArtifactId)
      : undefined;
    const labelMatches = downloads.filter((item) => (
      normalizedLabel === item.fileName || normalizedLabel.endsWith(item.fileName)
    ));
    const verified = exactUrl
      || exactArtifact
      || (labelMatches.length === 1 ? labelMatches[0] : undefined)
      || (downloads.length === 1 ? downloads[0] : undefined);
    if (!verified) return full;
    return `[${label}](${verified.downloadUrl}${suffix})`;
  });
}

export function repairFileArtifactDownloadLinks(reply: string, tools: FileArtifactToolResult[]) {
  const downloads = tools
    .flatMap(fileArtifactDownloadsFromToolResult)
    .filter((item): item is FileArtifactDownload => Boolean(item));
  const unique = [...new Map(downloads.map((item) => [item.artifactId, item])).values()];
  return repairArtifactDownloadLinks(reply, unique);
}

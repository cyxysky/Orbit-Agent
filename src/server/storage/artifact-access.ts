import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { artifactContentType } from '@webpilot/capability-file';
import type { CommunicationMediaOperations } from '@webpilot/capability-communication';
import { normalizeApplicationUserId } from '@/server/auth/user-context';
import type { BrowserChatSessionSnapshot } from '@/server/ai/agents/browser-chat.service';
import { readBrowserChatSessionHeader } from './browser-chat-history-store';
import { artifactsRoot } from './paths';

/** Resolve an existing artifact using the same owner boundary as artifact downloads. */
export async function resolveOwnedArtifact(segments: string[], userId: string | undefined) {
  if (!segments.length || segments.some(segment => !segment || segment === '.' || segment === '..' || /[\\/:\0]/.test(segment))) {
    throw new Error('Invalid artifact path.');
  }
  const ownerId = normalizeApplicationUserId(userId);
  let owned = ownerId === normalizeApplicationUserId(undefined);
  if (segments[0] === 'uploads') {
    owned = segments.length >= 3 && segments[1] === ownerId;
  } else if (segments[0].startsWith('chat_')) {
    const session = await readBrowserChatSessionHeader<BrowserChatSessionSnapshot>(segments[0]);
    owned = Boolean(session && normalizeApplicationUserId(session.userId) === ownerId);
  }
  if (!owned) throw new Error('Artifact not found.');
  const root = await realpath(artifactsRoot());
  const requestedPath = path.resolve(root, ...segments);
  const filePath = await realpath(requestedPath);
  const relative = path.relative(root, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid artifact path.');
  if (path.relative(requestedPath, filePath)) throw new Error('Artifact links are not supported.');
  return filePath;
}

export function communicationArtifactReader(userId: string | undefined): CommunicationMediaOperations['readArtifact'] {
  return async (artifactId, execution) => {
    execution.abortSignal?.throwIfAborted();
    const source = await resolveOwnedArtifact(artifactId.split('/'), userId);
    const info = await stat(source);
    if (!info.isFile() || !info.size || info.size > 50 * 1024 * 1024) throw new Error('发送的媒体文件必须大于 0 字节且不超过 50 MB。');
    return { fileName: path.basename(source), mediaType: artifactContentType(source), data: await readFile(source, { signal: execution.abortSignal }) };
  };
}

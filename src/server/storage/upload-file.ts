import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { uploadStorageExtension } from '@webpilot/capability-file';
import { artifactApiUrlFromRelative } from '@/lib/artifacts';
import { normalizeApplicationUserId } from '@/server/auth/user-context';
import { ApiRequestError } from '@/server/http/api-request';
import { artifactPath } from './paths';
import { readReferencedUploadPaths } from './database-record-store';
import { enforceUserUploadQuota } from './upload-artifact-lifecycle';

export function uploadMaxBytes() {
  const configured = Number(process.env.WEBPILOT_UPLOAD_MAX_BYTES || 50 * 1024 * 1024);
  return Number.isFinite(configured)
    ? Math.min(512 * 1024 * 1024, Math.max(1024, Math.floor(configured)))
    : 50 * 1024 * 1024;
}

/** All inbound channels use the same upload ownership, size, quota and URL contract. */
export async function storeUploadedFile(input: { userId: string; name: string; type: string; source: Readable }) {
  const userId = normalizeApplicationUserId(input.userId);
  const name = input.name.replace(/\\/g, '/').split('/').at(-1)?.replace(/[\x00-\x1f]/g, '').trim().slice(0, 180) || 'upload.bin';
  const type = input.type.split(';')[0].trim() || 'application/octet-stream';
  const ext = uploadStorageExtension(name, type);
  const fileId = `${type.startsWith('image/') ? 'img' : 'file'}_${Date.now()}_${randomUUID().slice(0, 12)}${ext}`;
  const relativePath = `uploads/${userId}/${fileId}`;
  const dir = artifactPath('uploads', userId);
  const filePath = path.join(dir, fileId);
  const maxBytes = uploadMaxBytes();
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > maxBytes ? new ApiRequestError('Upload is too large', { code: 'payload_too_large', status: 413 }) : null, chunk);
    },
  });
  await mkdir(dir, { recursive: true });
  try {
    await pipeline(input.source, limiter, createWriteStream(filePath, { flags: 'wx', mode: 0o600 }));
    if (!bytes) throw new ApiRequestError('File must not be empty');
    const quota = await enforceUserUploadQuota(userId, await readReferencedUploadPaths(userId), { protectedPath: filePath });
    if (quota.overQuota) throw new ApiRequestError('Upload storage quota exceeded', { code: 'storage_quota_exceeded', status: 413 });
    return { fileId, imageId: type.startsWith('image/') ? fileId : undefined,
      path: relativePath, url: artifactApiUrlFromRelative(relativePath), name, type, size: bytes };
  } catch (error) {
    await unlink(filePath).catch(() => undefined);
    throw error;
  }
}

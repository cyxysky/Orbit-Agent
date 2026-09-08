import { Readable } from 'node:stream';
import { NextRequest } from 'next/server';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { ApiRequestError, apiError, apiJson } from '@/server/http/api-request';
import { readReferencedUploadPaths } from '@/server/storage/database-record-store';
import {
  scheduleUploadArtifactMaintenance,
  userUploadUsage,
} from '@/server/storage/upload-artifact-lifecycle';

import { storeUploadedFile, uploadMaxBytes } from '@/server/storage/upload-file';

function decodedUploadName(value: string | null) {
  if (!value || value.length > 2_048) return 'upload.bin';
  try {
    return decodeURIComponent(value).trim() || 'upload.bin';
  } catch {
    throw new ApiRequestError('Upload file name is invalid');
  }
}


scheduleUploadArtifactMaintenance(readReferencedUploadPaths);

export async function GET(request: NextRequest) {
  try {
    return apiJson(request, { usage: await userUploadUsage(requestApplicationUserId(request)) });
  } catch (error) {
    return apiError(request, error, { code: 'upload_usage_failed', fallback: 'Unable to read upload usage', status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const maxBytes = uploadMaxBytes();
    const contentLengthHeader = request.headers.get('content-length');
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : undefined;
    const isRawUpload = request.headers.get('x-webpilot-upload') === 'raw';
    const requestLimit = isRawUpload ? maxBytes : maxBytes + 1024 * 1024;
    if (contentLength !== undefined && Number.isFinite(contentLength) && contentLength > requestLimit) {
      throw new ApiRequestError('Upload is too large', { code: 'payload_too_large', status: 413 });
    }
    let name: string;
    let type: string;
    let source: Readable;
    if (isRawUpload) {
      if (!request.body) throw new ApiRequestError('File is required');
      name = decodedUploadName(request.headers.get('x-webpilot-file-name'));
      type = String(request.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
      source = Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]);
    } else {
      const form = await request.formData().catch(() => {
        throw new ApiRequestError('Upload request must be valid multipart form data');
      });
      const file = form.get('file');
      if (!(file instanceof File)) throw new ApiRequestError('File is required');
      if (file.size <= 0 || file.size > maxBytes) {
        throw new ApiRequestError(`File size must be between 1 byte and ${maxBytes} bytes`, {
          code: 'payload_too_large',
          status: 413,
        });
      }
      name = file.name;
      type = file.type || 'application/octet-stream';
      source = Readable.fromWeb(file.stream() as Parameters<typeof Readable.fromWeb>[0]);
    }

    const upload = await storeUploadedFile({ userId: requestApplicationUserId(request), name, type, source });
    return apiJson(request, upload);
  } catch (error) {
    return apiError(request, error, {
      code: 'upload_failed',
      fallback: 'File upload failed',
      status: 500,
    });
  }
}

import { runtimeConfiguration } from '@/server/settings/runtime-configuration';
import { Readable } from 'node:stream';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { ApiRequestError, apiError, apiJson } from '@/server/http/api-request';
import { readReferencedUploadPaths } from '@/server/storage/database-record-store';
import {
  scheduleUploadArtifactMaintenance,
  userUploadUsage,
} from '@/server/storage/upload-artifact-lifecycle';

import { storeUploadedFile, uploadMaxBytes } from '@/server/storage/upload-file';
import { ERROR_CODES } from '@cjfclonedeep/capability-sdk';
import { store } from '@/server/db/store';
import { acceptsChatAttachment, readChatInterfaceSettings } from '@/lib/chat-interface-settings';


function decodedUploadName(value: string | null) {
  if (!value || value.length > 2_048) return 'upload.bin';
  try {
    return decodeURIComponent(value).trim() || 'upload.bin';
  } catch {
    throw new ApiRequestError('Upload file name is invalid');
  }
}


scheduleUploadArtifactMaintenance(readReferencedUploadPaths);

export async function GET(request: Request) {
  try {
    return apiJson(request, { usage: await userUploadUsage(requestApplicationUserId(request)) });
  } catch (error) {
    return apiError(request, error, { code: ERROR_CODES.UPLOAD_USAGE_FAILED, fallback: 'Unable to read upload usage', status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await store.refreshRuntimeSettings();
    const policy = readChatInterfaceSettings(runtimeConfiguration());
    if (!policy.attachmentUploadEnabled) throw new ApiRequestError('附件上传已关闭', { status: 403 });
    const maxBytes = uploadMaxBytes();
    const contentLengthHeader = request.headers.get('content-length');
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : undefined;
    const isRawUpload = request.headers.get('x-webpilot-upload') === 'raw';
    const requestLimit = isRawUpload ? maxBytes : maxBytes + 1024 * 1024;
    if (contentLength !== undefined && Number.isFinite(contentLength) && contentLength > requestLimit) {
      throw new ApiRequestError('Upload is too large', { code: ERROR_CODES.PAYLOAD_TOO_LARGE, status: 413 });
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
          code: ERROR_CODES.PAYLOAD_TOO_LARGE,
          status: 413,
        });
      }
      name = file.name;
      type = file.type || 'application/octet-stream';
      source = Readable.fromWeb(file.stream() as Parameters<typeof Readable.fromWeb>[0]);
    }

    if (!acceptsChatAttachment({ name, type }, policy.attachmentAccept)) {
      source.destroy();
      throw new ApiRequestError('不支持此附件类型，请查看设置中的附件支持类型', { status: 415 });
    }
    const upload = await storeUploadedFile({ userId: requestApplicationUserId(request), name, type, source });
    return apiJson(request, upload);
  } catch (error) {
    return apiError(request, error, {
      code: ERROR_CODES.UPLOAD_FAILED,
      fallback: 'File upload failed',
      status: 500,
    });
  }
}

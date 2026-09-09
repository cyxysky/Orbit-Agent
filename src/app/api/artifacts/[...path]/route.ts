import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { requestApplicationUserId } from '@/server/auth/user-context';
import { resolveOwnedArtifact } from '@/server/storage/artifact-access';
import { ApiRequestError, apiError, apiRequestId } from '@/server/http/api-request';
import { artifactContentType } from '@webpilot/capability-file';

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

function contentDispositionHeader(filePath: string) {
  return path.basename(filePath).replace(/["\r\n]/g, '_');
}

function requestedByteRange(value: string | null, size: number) {
  if (!value) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[2] && match[1] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) return null;
  return { end: Math.min(end, size - 1), start };
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const requestId = apiRequestId(request);
    const { path: pathSegments } = await context.params;
    const userId = requestApplicationUserId(request);
    const filePath = await resolveOwnedArtifact(pathSegments || [], userId);
    const fileStat = await stat(/*turbopackIgnore: true*/ filePath);
    if (!fileStat.isFile()) {
      throw new ApiRequestError('Artifact not found', { code: 'not_found', status: 404 });
    }

    const nativePreview = request.nextUrl.searchParams.get('preview') === 'pdf'
      && /\.(pptx?|pptm|ppsx?|odp)$/i.test(filePath);
    let previewPdf: Buffer | undefined;
    if (nativePreview) {
      const { readOfficePreviewPdf } = await import('@webpilot/capability-file/node/office');
      previewPdf = await readOfficePreviewPdf({ absolutePath: filePath, extension: path.extname(filePath) });
      if (!previewPdf) throw new ApiRequestError('Presentation preview is unavailable', { code: 'preview_unavailable', status: 503 });
    }
    const contentType = previewPdf ? 'application/pdf' : artifactContentType(filePath);
    const size = previewPdf ? previewPdf.length : fileStat.size;
    const range = requestedByteRange(request.headers.get('range'), size);
    if (range === null) {
      return new NextResponse(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}`, 'x-request-id': requestId },
      });
    }

    const headers: Record<string, string> = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Content-Length': String(range ? range.end - range.start + 1 : size),
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      'x-request-id': requestId,
    };
    if (/^(text\/html|image\/svg\+xml)(?:;|$)/.test(contentType)) {
      headers['Content-Security-Policy'] = "sandbox; default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'";
    }
    if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
    if (request.nextUrl.searchParams.get('download') === '1') {
      const fileName = contentDispositionHeader(previewPdf ? filePath.replace(/\.[^.]+$/, '.pdf') : filePath);
      const asciiName = fileName.replace(/[^\x20-\x7E]/g, '_');
      headers['Content-Disposition'] = `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
    }

    const body = previewPdf
      ? new Uint8Array(range ? previewPdf.subarray(range.start, range.end + 1) : previewPdf)
      : Readable.toWeb(createReadStream(filePath, range || undefined)) as unknown as BodyInit;
    return new NextResponse(body, { headers, status: range ? 206 : 200 });
  } catch (error) {
    return apiError(request, error, {
      code: 'not_found',
      fallback: 'Artifact not found',
      status: 404,
    });
  }
}

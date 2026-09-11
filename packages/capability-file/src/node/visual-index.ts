import type { FilePreviewResult } from './office/preview.ts';

export function fileVisualScreenshotId(pageNumber: number) {
  return `screenshot-${String(pageNumber).padStart(4, '0')}`;
}

/** One index contract for render results and explicit index pagination. */
export function createFileVisualIndex(input: {
  artifactId: string;
  fileName: string;
  preview: FilePreviewResult;
  offset?: number;
  limit?: number;
}) {
  const screenshotCount = input.preview.pageCount;
  if (typeof screenshotCount !== 'number' || !Number.isSafeInteger(screenshotCount) || screenshotCount < 1) {
    throw new Error('A file visual index requires a valid rendered page count.');
  }
  const offset = Math.min(Math.max(0, Math.floor(input.offset || 0)), screenshotCount);
  const limit = Math.min(Math.max(1, Math.floor(input.limit || 100)), 200);
  const end = Math.min(screenshotCount, offset + limit);
  const screenshots = Array.from({ length: end - offset }, (_, index) => {
    const pageNumber = offset + index + 1;
    return { screenshotId: fileVisualScreenshotId(pageNumber), pageNumber };
  });
  return {
    kind: 'file-visual-index' as const,
    artifactId: input.artifactId,
    fileName: input.fileName,
    screenshotCount,
    screenshots,
    offset,
    nextOffset: end < screenshotCount ? end : null,
    nextRead: screenshots.length ? {
      action: 'visualRead' as const,
      artifactId: input.artifactId,
      screenshotIds: screenshots.slice(0, 8).map((screenshot) => screenshot.screenshotId),
    } : null,
    renderer: input.preview.renderer,
    warning: input.preview.warning,
    automaticChecks: input.preview.automaticChecks || [],
    automaticCheckScope: 'render-integrity-only: dimensions and near-blank detection; this is not a visual-quality verdict',
    instruction: 'Use nextRead to inspect the first batch directly; do not repeat visualIndex for screenshots already listed here. Continue visualRead in batches of one to eight listed screenshotIds. Use visualIndex with nextOffset only for additional index entries. This index is not evidence that the model has viewed or reviewed the pages.',
  };
}

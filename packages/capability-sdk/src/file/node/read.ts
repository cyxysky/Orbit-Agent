import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import sharp from 'sharp';
import { fileFormatForName, normalizedFileExtension } from '../formats.ts';
import type { FileVisualToolInput } from '../types.ts';
import type {
  OfficeVisualQaDeckChecks,
  OfficeVisualQaPageChecks,
} from '../office/types.ts';
import { renderFilePreview } from './office/preview.ts';
import { createFileVisualIndex, fileVisualScreenshotId as screenshotId } from './visual-index.ts';
import { extractFileTextInWorker, type FileTextSelection, type FileTextExtractionResult } from './text-extraction.ts';

export type FileReadableAttachment = {
  id: string;
  kind?: 'file' | 'image' | 'tab';
  name: string;
  path: string;
  size?: number;
  sourceUrl?: string;
  type: string;
  url: string;
};

export type FileAttachmentReadResult = {
  actual: string;
  ok: boolean;
  referenceImagePaths?: string[];
};

export type FileVisualInput = FileVisualToolInput;

export const FILE_READ_MIN_CHARACTERS = 1;
export const FILE_READ_DEFAULT_CHARACTERS = 8_000;
export const FILE_READ_MAX_CHARACTERS = 40_000;

export function normalizeFileReadLimit(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number)
    ? Math.min(FILE_READ_MAX_CHARACTERS, Math.max(FILE_READ_MIN_CHARACTERS, Math.floor(number)))
    : FILE_READ_DEFAULT_CHARACTERS;
}

const visualQaPageCheckNames = [
  'overlap', 'clipping', 'alignment', 'spacing', 'typography', 'contrast',
  'visualHierarchy', 'chartTableLegibility', 'imageQuality',
] as const;
const visualQaDeckCheckNames = [
  'templateConsistency', 'typographyConsistency', 'colorConsistency',
  'spacingRhythm', 'componentConsistency',
] as const;

function assertVisualQaPageChecks(checks: OfficeVisualQaPageChecks | undefined, label: string) {
  if (!checks || typeof checks !== 'object') throw new Error(`${label} requires all visual-quality checks`);
  const failed: string[] = [];
  for (const name of visualQaPageCheckNames) {
    const status = checks[name];
    if (status !== 'passed' && status !== 'failed' && status !== 'not-applicable') throw new Error(`${label} requires check ${name}`);
    if (status === 'not-applicable' && name !== 'chartTableLegibility' && name !== 'imageQuality') throw new Error(`${label} cannot mark ${name} not-applicable`);
    if (status === 'failed') failed.push(name);
  }
  return failed;
}

function assertVisualQaDeckChecks(checks: OfficeVisualQaDeckChecks | undefined) {
  if (!checks || typeof checks !== 'object') throw new Error('deckReview requires all cross-page consistency checks');
  const failed: string[] = [];
  for (const name of visualQaDeckCheckNames) {
    const status = checks[name];
    if (status !== 'passed' && status !== 'failed') throw new Error(`deckReview requires check ${name}`);
    if (status === 'failed') failed.push(name);
  }
  for (const name of ['designIntent', 'compositionRhythm', 'contentConsistency', 'sourceTraceability'] as const) {
    const status = checks[name];
    if (status === undefined) continue;
    if (status !== 'passed' && status !== 'failed') throw new Error(`deckReview has invalid check ${name}`);
    if (status === 'failed') failed.push(name);
  }
  return failed;
}

type AttachmentKind = 'archive' | 'image' | 'pdf' | 'presentation' | 'spreadsheet' | 'tab' | 'text' | 'unknown' | 'word';

function normalizedOffset(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function extensionOf(attachment: FileReadableAttachment) {
  return normalizedFileExtension(attachment.name);
}

function formatSize(size?: number) {
  if (!size || size < 1024) return `${size || 0} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentKind(attachment: FileReadableAttachment): AttachmentKind {
  const format = fileFormatForName(attachment.name);
  if (attachment.kind === 'image' || attachment.type.startsWith('image/') || format?.kind === 'image') return 'image';
  if (attachment.kind === 'tab') return 'tab';
  if (attachment.type === 'application/pdf' || format?.kind === 'pdf') return 'pdf';
  if (format?.canRead && format.kind !== 'binary' && format.kind !== 'audio' && format.kind !== 'video') return format.kind;
  if (attachment.type.startsWith('text/')) return 'text';
  return 'unknown';
}

export function isImageFileAttachment(attachment: FileReadableAttachment) {
  return attachmentKind(attachment) === 'image';
}

export function fileAttachmentMetadata(attachment: FileReadableAttachment) {
  return `[文件] ${attachment.name} | attachmentId: ${attachment.id} | 类型: ${attachment.type || 'unknown'} | 大小: ${formatSize(attachment.size)} | 仅在任务需要分析文件内容时调用 file action=read；纯上传不要读取或重建内容，使用浏览器运行时提供的受控附件上传接口。`;
}

async function extractAttachmentText(attachment: FileReadableAttachment, absolutePath?: string, reusableBuffer?: Buffer, selection: FileTextSelection & { abortSignal?: AbortSignal } = {}): Promise<FileTextExtractionResult> {
  const kind = attachmentKind(attachment);
  if (kind === 'image') {
    if (!absolutePath) throw new Error('Could not locate the saved image artifact.');
    const buffer = reusableBuffer || await readFile(absolutePath);
    const metadata = await sharp(buffer, { failOn: 'none' }).metadata();
    const rawWidth = metadata.width || 0;
    const rawHeight = metadata.height || 0;
    const swapsAxes = [5, 6, 7, 8].includes(metadata.orientation || 0);
    const width = swapsAxes ? rawHeight : rawWidth;
    const height = swapsAxes ? rawWidth : rawHeight;
    return { parser: 'image-metadata', truncated: false, warnings: [], text: [
      '[Image artifact metadata]',
      `Name: ${attachment.name}`,
      `Saved bytes: ${buffer.byteLength}`,
      `Format: ${metadata.format || extensionOf(attachment).replace(/^\./, '') || 'unknown'}`,
      `Dimensions: ${width || 'unknown'} x ${height || 'unknown'} px`,
      `Aspect ratio: ${width && height ? (width / height).toFixed(6) : 'unknown'}`,
      ...(metadata.orientation ? [`EXIF orientation: ${metadata.orientation}`] : []),
      'These values were read from the exact saved artifact bytes. Use them for Office layout instead of probing the remote source URL in browserCode.',
    ].join('\n') };
  }
  if (kind === 'tab') return { parser: 'tab', truncated: false, warnings: [], text: `[标签页引用：${attachment.sourceUrl || attachment.url || attachment.name}]` };
  if (!absolutePath) throw new Error('无法定位文件，无法解析。');
  return extractFileTextInWorker({ extension: extensionOf(attachment), kind, path: absolutePath, ...selection });
}

export async function readFileAttachment(input: FileTextSelection & {
  abortSignal?: AbortSignal;
  attachment: FileReadableAttachment;
  absolutePath?: string;
  includeVisuals?: boolean;
  limit?: unknown;
  offset?: unknown;
  pages?: unknown;
  previewRoot?: string;
}): Promise<FileAttachmentReadResult> {
  const { attachment } = input;
  if (!input.absolutePath && attachment.kind !== 'tab') {
    return { ok: false, actual: `无法定位上传文件：${attachment.name}` };
  }
  try {
    input.abortSignal?.throwIfAborted();
    const size = attachment.kind === 'tab' ? attachment.size : (await stat(input.absolutePath!)).size;
    const resolvedAttachment = size === attachment.size ? attachment : { ...attachment, size };
    if (attachment.kind !== 'tab' && size === 0) throw new Error('文件内容为空，无法解析。');
    const kind = attachmentKind(resolvedAttachment);
    const buffer = input.includeVisuals && kind !== 'tab'
      ? await readFile(input.absolutePath!)
      : undefined;
    const [content, visuals] = await Promise.all([
      extractAttachmentText(resolvedAttachment, input.absolutePath, buffer, {
        sheet: input.sheet, range: input.range, contentPages: input.contentPages, section: input.section, abortSignal: input.abortSignal,
      }),
      input.includeVisuals && buffer
        ? renderFilePreview({
            absolutePath: input.absolutePath!,
            buffer,
            extension: extensionOf(resolvedAttachment),
            name: resolvedAttachment.name,
            pages: input.pages,
            previewRoot: input.previewRoot,
          })
        : undefined,
    ]);
    const offset = normalizedOffset(input.offset);
    input.abortSignal?.throwIfAborted();
    const limit = normalizeFileReadLimit(input.limit);
    const slice = content.text.slice(offset, offset + limit);
    const nextOffset = offset + slice.length;
    const visualSummary = visuals ? [
      `视觉内容：渲染器=${visuals.renderer}${visuals.pageCount ? `；总页数=${visuals.pageCount}` : ''}${visuals.renderedPages.length ? `；本次页面=${visuals.renderedPages.join(',')}` : ''}${visuals.imagePaths.length ? `；已向下一轮模型请求附加 ${visuals.imagePaths.length} 张图像` : ''}`,
      visuals.warning || '',
    ].filter(Boolean) : [];
    return {
      ok: !(input.includeVisuals && kind === 'image' && !visuals?.imagePaths.length),
      actual: [
        '读取类型：文件内容（readContent）；以下是从文件解析出的文本/数据，不是生成此文件的 Python/JavaScript 源码。修改生成逻辑请用 readSource + documentId；缺少 documentId 时先 list。',
        `文件：${resolvedAttachment.name}`,
        `类型：${resolvedAttachment.type || 'unknown'}；大小：${formatSize(resolvedAttachment.size)}；解析器：${content.parser}`,
        '原始附件：服务器保留原始字节；文本、结构和视觉预览均从该原件按需派生。',
        `读取范围：${JSON.stringify(content.scope || {})}；提取截断：${content.truncated ? '是，请缩小选择范围' : '否'}`,
        ...content.warnings.map((warning) => `读取提示：${warning}`),
        ...visualSummary,
        ...(input.includeVisuals && kind === 'image' && !visuals?.imagePaths.length
          ? ['图片像素未能附加；以下仅为元数据，不能据此确认图片主体或视觉质量。请使用可解码的图片素材。'] : []),
        `字符区间：${offset}-${nextOffset} / ${content.text.length}${nextOffset < content.text.length ? `；仍有内容，下次 offset=${nextOffset}` : content.truncated ? '；已到本次提取末尾，原文档尚未完整读取' : '；已到所选范围末尾'}`,
        '',
        slice || '[该区间没有可读文本]',
      ].join('\n'),
      referenceImagePaths: visuals?.imagePaths.length ? visuals.imagePaths : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '无法读取文件内容。';
    return { ok: false, actual: `读取文件 ${attachment.name} 失败：${message}` };
  }
}

function screenshotPage(value: string) {
  const match = /^screenshot-(\d{1,8})$/i.exec(value.trim());
  if (!match) return undefined;
  const pageNumber = Number(match[1]);
  return Number.isSafeInteger(pageNumber) && pageNumber > 0 ? pageNumber : undefined;
}

/**
 * Lazily indexes or reads rendered pages for one conversation artifact.
 * Indexing returns stable screenshot ids without attaching images. Reading a
 * bounded id batch returns image paths that the executor adds to the next
 * model request.
 */
export async function readFileVisuals(input: {
  attachment: FileReadableAttachment;
  absolutePath?: string;
  request: FileVisualInput;
  previewRoot?: string;
}): Promise<FileAttachmentReadResult> {
  const { attachment, request } = input;
  if (!input.absolutePath) {
    return { ok: false, actual: `file action=visualIndex could not locate artifact ${request.artifactId}.` };
  }
  if (attachmentKind(attachment) === 'image' || attachmentKind(attachment) === 'tab') {
    return { ok: false, actual: 'File visual actions support paged PDF and Office artifacts, not standalone images or tab references.' };
  }

  try {
    const metadata = await stat(input.absolutePath);
    if (!metadata.size) throw new Error('artifact is empty');
    if (request.action === 'report') {
      if (!request.reviews?.length) return { ok: false, actual: 'file action=visualReport requires at least one page review.' };
      const reviews = request.reviews.map((review) => {
        const pageNumber = screenshotPage(review.screenshotId);
        if (!pageNumber) throw new Error(`invalid screenshotId in visual review: ${review.screenshotId}`);
        const issues = (review.issues || []).map((issue) => ({
          type: String(issue.type || '').trim(),
          description: String(issue.description || '').trim(),
          ...(issue.region ? { region: String(issue.region).trim() } : {}),
          ...(issue.severity ? { severity: issue.severity } : {}),
        })).filter((issue) => issue.type && issue.description);
        const observation = String(review.observation || '').trim();
        if (observation.length < 20) throw new Error(`review ${review.screenshotId} requires a concrete visual observation of at least 20 characters`);
        const failedChecks = assertVisualQaPageChecks(review.checks, `review ${review.screenshotId}`);
        if (review.status === 'passed' && issues.length) throw new Error(`passed review ${review.screenshotId} cannot contain issues`);
        if (review.status === 'failed' && !issues.length) throw new Error(`failed review ${review.screenshotId} requires at least one issue`);
        if (review.status === 'passed' && failedChecks.length) throw new Error(`passed review ${review.screenshotId} cannot contain failed checks`);
        if (review.status === 'failed' && !failedChecks.length) throw new Error(`failed review ${review.screenshotId} requires at least one failed check`);
        return { screenshotId: review.screenshotId, pageNumber, status: review.status, observation, checks: review.checks, issues };
      });
      const deckReview = request.deckReview ? {
        status: request.deckReview.status,
        observation: String(request.deckReview.observation || '').trim(),
        checks: request.deckReview.checks,
        issues: (request.deckReview.issues || []).map((issue) => ({
          type: String(issue.type || '').trim(),
          description: String(issue.description || '').trim(),
          ...(issue.region ? { region: String(issue.region).trim() } : {}),
          ...(issue.severity ? { severity: issue.severity } : {}),
        })).filter((issue) => issue.type && issue.description),
      } : undefined;
      if (deckReview && deckReview.observation.length < 30) throw new Error('deckReview requires a concrete cross-page observation of at least 30 characters');
      const failedDeckChecks = deckReview ? assertVisualQaDeckChecks(deckReview.checks) : [];
      if (deckReview?.status === 'passed' && deckReview.issues.length) throw new Error('passed deckReview cannot contain issues');
      if (deckReview?.status === 'failed' && !deckReview.issues.length) throw new Error('failed deckReview requires at least one issue');
      if (deckReview?.status === 'passed' && failedDeckChecks.length) throw new Error('passed deckReview cannot contain failed checks');
      if (deckReview?.status === 'failed' && !failedDeckChecks.length) throw new Error('failed deckReview requires at least one failed check');
      return {
        ok: true,
        actual: JSON.stringify({
          kind: 'file-visual-report',
          artifactId: request.artifactId,
          fileName: attachment.name,
          reviews,
          ...(deckReview ? { deckReview } : {}),
          instruction: reviews.some((review) => review.status === 'failed') || deckReview?.status === 'failed'
            ? 'Fix every reported issue, render a replacement artifact, and restart visualRead using the new render result visualIndex and its exact artifactId/screenshotIds.'
            : 'Continue reading and reporting unreviewed pages until every indexed page has an evidence-backed passed review, then submit a passed deckReview comparing cross-page consistency.',
        }),
      };
    }
    const requestedScreenshotIds = Array.from(new Set((request.screenshotIds || []).map((value) => value.trim()).filter(Boolean)));
    if (request.action === 'read' && !requestedScreenshotIds.length) {
      return { ok: false, actual: 'file action=visualRead requires at least one screenshotId from render.visualIndex or action=visualIndex.' };
    }
    if (requestedScreenshotIds.length > 8) {
      return { ok: false, actual: 'file action=visualRead accepts at most 8 screenshotIds per call. Read larger documents in ordered batches.' };
    }
    const requestedPages = requestedScreenshotIds.map(screenshotPage);
    if (request.action === 'read' && requestedPages.some((page) => page === undefined)) {
      return { ok: false, actual: 'file action=visualRead received an invalid screenshotId. Use the exact screenshot-NNNN ids from render.visualIndex or action=visualIndex.' };
    }

    const visuals = await renderFilePreview({
      absolutePath: input.absolutePath,
      cacheKey: `${request.artifactId}\0${metadata.size}\0${metadata.mtimeMs}`,
      extension: extensionOf(attachment),
      name: attachment.name,
      pages: request.action === 'read' ? requestedPages : [1],
      previewRoot: input.previewRoot,
    });
    const screenshotCount = visuals.pageCount;
    if (typeof screenshotCount !== 'number' || !Number.isSafeInteger(screenshotCount) || screenshotCount < 1) {
      return {
        ok: false,
        actual: `File visual inspection could not create a paged preview for ${attachment.name}.${visuals.warning ? ` ${visuals.warning}` : ''}`,
      };
    }

    if (request.action === 'index') {
      return {
        ok: true,
        actual: JSON.stringify(createFileVisualIndex({
          artifactId: request.artifactId,
          fileName: attachment.name,
          preview: visuals,
          offset: request.offset,
          limit: request.limit,
        })),
      };
    }

    const imagePathByPage = new Map(visuals.renderedPages.map((pageNumber, index) => [pageNumber, visuals.imagePaths[index]]));
    const missing = (requestedPages as number[]).filter((pageNumber) => !imagePathByPage.get(pageNumber));
    const orderedImagePaths = (requestedPages as number[]).map((pageNumber) => imagePathByPage.get(pageNumber)).filter((value): value is string => Boolean(value));
    if (missing.length || orderedImagePaths.length !== requestedPages.length) {
      return {
        ok: false,
        actual: `file action=visualRead could not render requested screenshot pages: ${missing.length ? missing.join(', ') : 'renderer returned an incomplete image set'}.`,
      };
    }
    const screenshotRecords = await Promise.all((requestedPages as number[]).map(async (pageNumber) => {
      const imagePath = imagePathByPage.get(pageNumber)!;
      return {
        screenshotId: screenshotId(pageNumber),
        pageNumber,
        screenshotDigest: createHash('sha256').update(await readFile(imagePath)).digest('hex'),
      };
    }));
    return {
      ok: true,
      actual: JSON.stringify({
        kind: 'file-visual-read',
        artifactId: request.artifactId,
        fileName: attachment.name,
        screenshotCount,
        screenshots: screenshotRecords,
        renderer: visuals.renderer,
        warning: visuals.warning,
        automaticChecks: visuals.automaticChecks || [],
        automaticCheckScope: 'render-integrity-only: dimensions and near-blank detection; this is not a visual-quality verdict',
        instruction: 'The requested screenshots are attached to the next model request. Inspect the actual pixels at a useful size: overlap, clipping, alignment, spacing, typography, contrast, hierarchy, composition, chart/table legibility, and image quality. Every chart must identify what each mark represents; reject 1/2/3 placeholder categories, generic-only series names, and missing or unreadable legends, axes, or data labels. Images must be contextually identified or captioned and carry alt/source attribution when required. A known visible defect cannot be waived as a compatibility limitation, and a bare passed result is invalid.',
      }),
      referenceImagePaths: orderedImagePaths,
    };
  } catch (error) {
    return {
      ok: false,
      actual: `File visual inspection failed for ${attachment.name}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

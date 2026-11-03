import { normalizeErrorCode } from "../../errors.ts";
import type {
  CapabilityExecutionContext,
  CapabilityResult,
  CapabilityRunContext,
} from '../../index.ts';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { nodeArtifactRelativePath, sanitizeNodeArtifactFileName } from './artifacts.ts';
import { fileFormatForName } from '../formats.ts';
import {
  createFileCapability,
  type FileArtifactOperationResult,
  type FileAttachmentBinding,
  type FileCapabilityRuntimeOperations,
  type FileReadInput,
  type FileToolInput,
  type FileVisualToolInput,
} from '../index.ts';
import type {
  FileGenerationProgress,
  NodeFileWorkspaceHost,
  NodeFileWorkspace,
} from './workspace.ts';
import { CodedError, ERROR_CODES } from '../../errors.ts';


type ContextValue<T> = T | ((context: CapabilityRunContext) => T | Promise<T>);

export type NodeFileCapabilityOptions = {
  workspace: ContextValue<NodeFileWorkspaceHost>;
  visualInputAvailable: boolean;
  /** Local workspace hosts can read artifacts across calls and tool providers. */
  artifactReadScope?: 'run' | 'workspace';
  attachmentBindings?: ContextValue<readonly FileAttachmentBinding[] | undefined>;
  sourcePageUrl?: ContextValue<string | undefined>;
  includeVisualVerification?: boolean;
  readFile?: (
    input: FileReadInput,
    context: CapabilityExecutionContext,
    runContext: CapabilityRunContext,
  ) => Promise<FileArtifactOperationResult>;
  readFileVisuals?: (
    input: FileVisualToolInput,
    context: CapabilityExecutionContext,
    runContext: CapabilityRunContext,
  ) => Promise<FileArtifactOperationResult>;
};

async function resolveContextValue<T>(value: ContextValue<T>, context: CapabilityRunContext) {
  return typeof value === 'function'
    ? (value as (context: CapabilityRunContext) => T | Promise<T>)(context)
    : value;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function fileOperationToCapabilityResult(
  result: FileArtifactOperationResult,
  fallbackErrorCode: string,
): CapabilityResult {
  const operationData = result.data !== undefined
    ? result.data
    : result.error?.details !== undefined
      ? result.error.details
      : result.actual;
  const imagePaths = result.referenceImagePaths?.filter(Boolean) || [];
  const operationRecord = record(operationData);
  // A summary must not repeat a serialized source/validation payload. Keep
  // the complete value once in data; adapters can display this short label.
  const explicitSummary = result.summary?.trim();
  const sourceRange = record(operationRecord?.sourceLineRange);
  const summary = explicitSummary && !/^[{\[]/.test(explicitSummary)
    ? explicitSummary.slice(0, 300)
    : operationRecord?.readKind === 'source' || operationRecord?.kind === 'uno-draft'
      ? `Source ${String(operationRecord.documentId || '')}: ${sourceRange ? `lines ${sourceRange.startLine}-${sourceRange.endLine}` : 'source index'}.`
      : `File operation completed${typeof operationRecord?.kind === 'string' ? `: ${operationRecord.kind}` : ''}.`;
  const data = imagePaths.length
    ? operationRecord
      ? { ...operationRecord, referenceImagePaths: imagePaths }
      : { actual: operationData, referenceImagePaths: imagePaths }
    : operationData;
  if (!result.ok) {
    return {
      ok: false,
      summary: result.summary,
      error: {
        code: normalizeErrorCode(result.error?.code, normalizeErrorCode(fallbackErrorCode, ERROR_CODES.FILE_OPERATION_FAILED)),
        message: result.error?.message || result.actual,
        retryable: result.error?.retryable,
        details: data,
      },
    };
  }

  const payload = record(data);
  const artifactId = typeof payload?.artifactId === 'string' ? payload.artifactId : undefined;
  const downloadUrl = typeof payload?.downloadUrl === 'string' ? payload.downloadUrl : undefined;
  const mediaType = typeof payload?.mimeType === 'string' ? payload.mimeType
    : typeof payload?.mediaType === 'string' ? payload.mediaType : undefined;
  const content = [
    ...(artifactId ? [{
      type: 'artifact' as const,
      artifactId,
      ...(downloadUrl ? { downloadUrl } : {}),
      ...(mediaType ? { mediaType } : {}),
    }] : []),
    ...imagePaths.map((imagePath) => ({
      type: 'image' as const,
      artifactId: imagePath,
    })),
  ];
  return {
    ok: true,
    summary,
    data,
    content: content.length ? content : undefined,
  };
}

function unavailable(message: string): CapabilityResult {
  return { ok: false, error: { code: ERROR_CODES.FILE_ACTION_UNAVAILABLE, message } };
}

function progressReporter(context: CapabilityExecutionContext) {
  return async (event: FileGenerationProgress) => context.reportProgress?.(event);
}

export async function createNodeFileOperations(
  options: NodeFileCapabilityOptions,
  runContext: CapabilityRunContext,
): Promise<FileCapabilityRuntimeOperations> {
  const [workspaceHost, configuredBindings, sourcePageUrl] = await Promise.all([
    resolveContextValue(options.workspace, runContext),
    options.attachmentBindings
      ? resolveContextValue(options.attachmentBindings, runContext)
      : undefined,
    options.sourcePageUrl
      ? resolveContextValue(options.sourcePageUrl, runContext)
      : undefined,
  ]);
  // Tool discovery and text writes do not need Office engines or parsers.
  let workspace: Promise<NodeFileWorkspace> | undefined;
  let disposed = false;
  const getWorkspace = () => {
    if (disposed) throw new CodedError(ERROR_CODES.FILE_OPERATION_FAILED, 'File workspace is closed.');
    return workspace ||= import('./workspace.ts').then(({ createNodeFileWorkspace }) => createNodeFileWorkspace({
      ...workspaceHost,
      configuration: { ...runContext.configuration, ...workspaceHost.configuration },
    })).catch(error => { workspace = undefined; throw error; });
  };
  const attachmentBindings = configuredBindings ? [...configuredBindings] : undefined;
  const runId = runContext.runId;
  const includeVisualVerification = options.includeVisualVerification === true;
  const resolveRunArtifact = async (artifactId: string) => {
    const root = await realpath(workspaceHost.artifactsRoot);
    const candidate = path.resolve(root, artifactId);
    nodeArtifactRelativePath(root, candidate);
    const absolutePath = await realpath(candidate);
    const relative = nodeArtifactRelativePath(root, absolutePath).relativePath;
    if (options.artifactReadScope !== 'workspace' && !relative.startsWith(`${sanitizeNodeArtifactFileName(runId, 'adhoc')}/`)) {
      throw new CodedError(ERROR_CODES.FILE_OPERATION_FAILED, 'Artifact does not belong to this run.');
    }
    return absolutePath;
  };

  const file: FileCapabilityRuntimeOperations['file'] = {
    list: async () => fileOperationToCapabilityResult(
      await (await getWorkspace()).listOfficeDrafts({ runId }),
      ERROR_CODES.FILE_LIST_FAILED,
    ),
    readSource: async (input, context) => fileOperationToCapabilityResult(await (await getWorkspace()).readUnoDraft({
      abortSignal: context.abortSignal,
      runId,
      documentId: input.documentId,
      path: input.path,
      startLine: input.startLine,
      endLine: input.endLine,
      includeDiagnostics: input.includeDiagnostics,
    }), ERROR_CODES.FILE_READ_SOURCE_FAILED),
    readContent: async (input, context) => {
      if (!options.readFile) {
        try {
          const binding = input.attachmentId ? attachmentBindings?.find((item) => item.ref === input.attachmentId) : undefined;
          let absolutePath: string;
          let name: string;
          if (binding) { absolutePath = binding.path; name = binding.name; }
          else if (input.artifactId && !input.attachmentId) {
            absolutePath = await resolveRunArtifact(input.artifactId);
            name = path.basename(absolutePath);
          } else return unavailable('Use an artifactId from this run or a registered attachmentId.');
          const { readFileAttachment } = await import('./read.ts');
          return fileOperationToCapabilityResult(await readFileAttachment({ ...input, absolutePath,
            abortSignal: context.abortSignal, previewRoot: path.join(workspaceHost.artifactsRoot, sanitizeNodeArtifactFileName(runId, 'adhoc'), 'attachment-previews'),
            attachment: { id: input.artifactId || input.attachmentId!, name, path: absolutePath,
              type: fileFormatForName(name)?.mimeType || 'application/octet-stream', url: '' },
          }), ERROR_CODES.FILE_READ_CONTENT_FAILED);
        } catch (error) {
          return fileOperationToCapabilityResult({ ok: false, actual: error instanceof Error ? error.message : String(error) }, ERROR_CODES.FILE_READ_CONTENT_FAILED);
        }
      }
      return fileOperationToCapabilityResult(await options.readFile({
        ...input, includeVisuals: input.includeVisuals === true,
      }, context, runContext), ERROR_CODES.FILE_READ_CONTENT_FAILED);
    },
    write: async (input: FileToolInput, context) => {
      if (disposed) throw new CodedError(ERROR_CODES.FILE_OPERATION_FAILED, 'File workspace is closed.');
      const { writeTextFileArtifact } = await import('./write.ts');
      return fileOperationToCapabilityResult(await writeTextFileArtifact({
        artifactsRoot: path.resolve(workspaceHost.artifactsRoot),
        artifactUrl: workspaceHost.artifactUrl || ((artifact) => pathToFileURL(artifact.absolutePath).href),
      }, { fileName: input.fileName, content: input.content, runId, abortSignal: context.abortSignal }), ERROR_CODES.FILE_WRITE_FAILED);
    },
    download: async (input: FileToolInput, context) => fileOperationToCapabilityResult(
      await (await getWorkspace()).downloadFileArtifact({
        runId,
        url: input.url,
        path: input.path,
        urlOrPath: input.urlOrPath,
        fileName: input.fileName,
        fileType: input.fileType,
        sourcePageUrl,
      }, { abortSignal: context.abortSignal }),
      ERROR_CODES.FILE_DOWNLOAD_FAILED,
    ),
    convert: async (input: FileToolInput, context) => fileOperationToCapabilityResult(
      await (await getWorkspace()).convertFileArtifact({
        runId,
        sourceArtifactId: input.sourceArtifactId,
        fileName: input.fileName,
        includeVisualVerification,
      }, { abortSignal: context.abortSignal }),
      ERROR_CODES.FILE_CONVERT_FAILED,
    ),
    plan: async (input: FileToolInput, context) => fileOperationToCapabilityResult(
      await (await getWorkspace()).planFileArtifact({
        abortSignal: context.abortSignal,
        runId,
        documentId: input.documentId,
        fileName: input.fileName,
        documentType: input.documentType,
        operation: input.operation,
        intent: input.intent,
        design: input.design,
        sourceAttachmentId: input.sourceAttachmentId,
        attachmentBindings,
      }),
      ERROR_CODES.FILE_PLAN_FAILED,
    ),
    unoApi: async (input: FileToolInput, context) => fileOperationToCapabilityResult(
      await (await getWorkspace()).getUnoApi({
        abortSignal: context.abortSignal,
        runId,
        documentId: input.documentId,
        documentType: input.documentType,
        query: input.query,
        offset: input.offset,
        limit: input.limit,
      }),
      ERROR_CODES.FILE_UNO_API_FAILED,
    ),
    jsApi: async (input: FileToolInput) => fileOperationToCapabilityResult(
      await (await getWorkspace()).getOfficeJsApi({
        runId,
        documentId: input.documentId,
        documentType: input.documentType,
      }),
      ERROR_CODES.FILE_JS_API_FAILED,
    ),
    generate: async (input: FileToolInput, context) => fileOperationToCapabilityResult(
      await (await getWorkspace()).generateUnoFileArtifact({
        runId,
        documentId: input.documentId,
        program: input.program,
        body: input.body,
        render: input.render,
        includeVisualVerification,
        attachmentBindings,
        abortSignal: context.abortSignal,
        onProgress: progressReporter(context),
      }),
      ERROR_CODES.FILE_GENERATE_FAILED,
    ),
    edit: async (input: FileToolInput, context) => fileOperationToCapabilityResult(
      await (await getWorkspace()).editUnoFileArtifact({
        runId,
        documentId: input.documentId,
        path: input.path,
        program: input.program,
        patch: input.patch,
        replacements: input.replacements,
        render: input.render,
        includeVisualVerification,
        attachmentBindings,
        abortSignal: context.abortSignal,
        onProgress: progressReporter(context),
      }),
      ERROR_CODES.FILE_EDIT_FAILED,
    ),
    render: async (input: FileToolInput, context) => fileOperationToCapabilityResult(
      await (await getWorkspace()).renderFileArtifact({
        runId,
        documentId: input.documentId,
        includeVisualVerification,
        attachmentBindings,
        abortSignal: context.abortSignal,
        onProgress: progressReporter(context),
      }),
      ERROR_CODES.FILE_RENDER_FAILED,
    ),
  };
  file.read = (input, context) => input.documentId
    ? file.readSource!({ ...input, action: 'readSource' }, context)
    : file.readContent!({ ...input, action: 'readContent' }, context);

  const visual = options.visualInputAvailable ? {
    index: executeVisual,
    read: executeVisual,
    report: executeVisual,
  } satisfies NonNullable<FileCapabilityRuntimeOperations['visual']> : undefined;

  async function executeVisual(input: FileVisualToolInput, context: CapabilityExecutionContext) {
    const current = await (await getWorkspace()).verifyCurrentUnoRenderedArtifact({
      runId,
      artifactId: input.artifactId,
    });
    if (!current.ok) return fileOperationToCapabilityResult(current, ERROR_CODES.FILE_VISUAL_VERSION_FAILED);
    context.abortSignal?.throwIfAborted();
    let visualResult: FileArtifactOperationResult;
    try {
      if (options.readFileVisuals) visualResult = await options.readFileVisuals(input, context, runContext);
      else {
        const absolutePath = await resolveRunArtifact(input.artifactId);
        const name = path.basename(absolutePath);
        const { readFileVisuals } = await import('./read.ts');
        visualResult = await readFileVisuals({ absolutePath, request: input,
          previewRoot: path.join(workspaceHost.artifactsRoot, sanitizeNodeArtifactFileName(runId, 'adhoc'), 'attachment-previews'),
          attachment: { id: input.artifactId, name, path: absolutePath, type: fileFormatForName(name)?.mimeType || 'application/octet-stream', url: '' },
        });
      }
    } catch (error) {
      return fileOperationToCapabilityResult({ ok: false, actual: error instanceof Error ? error.message : String(error) }, ERROR_CODES.FILE_VISUAL_READ_FAILED);
    }
    context.abortSignal?.throwIfAborted();
    return fileOperationToCapabilityResult(await (await getWorkspace()).recordOfficeVisualQaProgress({
      runId,
      artifactId: input.artifactId,
      action: input.action,
      result: visualResult,
    }), ERROR_CODES.FILE_VISUAL_REPORT_FAILED);
  }

  return {
    file,
    visual,
    health: async () => (await getWorkspace()).health(),
    async dispose() {
      disposed = true;
      const pending = workspace;
      workspace = undefined;
      await (await pending)?.dispose();
    },
  };
}

export function createNodeFileCapability(options: NodeFileCapabilityOptions) {
  return createFileCapability({
    visualInputAvailable: options.visualInputAvailable,
    createOperations: (context) => createNodeFileOperations(options, context),
  });
}

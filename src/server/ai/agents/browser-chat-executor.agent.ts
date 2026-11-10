import { runtimeConfiguration } from '@/server/settings/runtime-configuration';
import { runtimeCapabilityConfigStore } from '@/server/settings/capability-config-store';
import { runtimeSetting } from '@/server/settings/runtime-configuration';
import { executeAppServerBrowserTurn } from './browser-chat-app-server-runtime';
import { executeBrowserInteraction } from './runtime-browser-interaction';
import { type BrowserChatInteractionMode } from '@/lib/browser-chat-interaction-mode';
import { artifactApiUrl } from '@/lib/artifacts';
import { browserChatCapabilityResult } from '@/lib/browser-chat-capability-result';
import { isRuntimeToolEnabled } from '@/server/runtime/self-bootstrap-policy';
import { coreResponses } from '@cjfclonedeep/capability-sdk/responses';
import { type StructuredResponse } from '@cjfclonedeep/capability-sdk';
import { contextReadToolName, type RuntimeContextManifest } from './runtime-context-assembler';
import { type RuntimeKnowledgeBlock } from './runtime-knowledge-context';
import { tool, type ModelMessage, type ToolSet } from 'ai';
import { z } from 'zod';
import { jsonRecordFromUnknown, type CapabilityProgressEvent } from '@cjfclonedeep/capability-sdk';
import { fileCapabilityToolNames, type FileReadInput } from '@cjfclonedeep/capability-sdk/file';
import { createManagedToolProviders } from '@/server/capabilities/managed-provider';
import { managedToolConfigurations, toolInstaller } from '@/server/capabilities/managed-tools';
import { managedToolRuntimeConfiguration } from '@cjfclonedeep/capability-sdk/managed/node';
import { browserCodeServiceFileDeliveryViolation } from './browser-chat-file-delivery';
import { sharedKnowledgeDirectory } from '@/server/capabilities/knowledge-storage';
import { createAISDKResponseTool, mountAISDKCapabilities } from '@cjfclonedeep/capability-sdk/ai-sdk';
import type { AiRequestSnapshot, AiToolContextSnapshot, BrowserOperationRecord, StepExecutionResult, StepToolCall, VisualFrameRecord } from '@/server/ai/schemas/runtime.schema';
import { getModelSettings } from '@/server/ai/model';
import { codexRuntimeError } from '@/server/ai/codex-runtime-errors';
import { agentSystemPrompt } from '@/server/ai/prompts/agent-system-prompt';
import { BrowserSession, type BrowserActionResult } from '@cjfclonedeep/capability-sdk/browser/node';
import { type BrowserCodeAttachmentBinding, type BrowserCodeCredentialBinding } from '@cjfclonedeep/capability-sdk/browser/node';
import { richTextToPlainText } from '@/lib/rich-text';
import { fileToolModelOutput } from './browser-chat-file-model-output';
import { nativeRuntimeToolNames, runtimeBuiltinToolPrompts } from './runtime-tool-catalog';
import { hiddenRuntimeSkillContent, hiddenRuntimeSkillForToolCall, hiddenRuntimeSkillIdsForTools, requireHiddenRuntimeSkillRead } from './hidden-runtime-skills';
import { subagentRuntimeSkillId } from './subagent-runtime-skill';
import { capabilityResultToBrowserActionResult } from '@/server/capabilities/browser-chat-result';
import { browserOperationSummary } from '@cjfclonedeep/capability-sdk/browser';
import { createAgentInfrastructureProviders } from '@/server/capabilities/agent-infrastructure';
import { executeBrowserChatFile } from '@/server/capabilities/browser-chat-file';
import { type BrowserChatFinalBlock } from '@/lib/browser-chat-ui-message';
import type { BrowserChatOutputPerformance } from '@/lib/browser-chat-activity';
import { type ReasoningStreamUpdate } from './browser-chat-reasoning-stream';
import { subagentResultActual } from './browser-chat-subagent-delivery';
import { formatFileArtifactResult } from '@cjfclonedeep/capability-sdk/file/node/workspace';
import { isProviderBillingLimitMessage } from './runtime-retry-policy';
import { browserToolApprovalRequest } from './browser-tool-approval';
import { withToolFailureGuidance } from './runtime-tool-failure-guidance';
import { sourceFileRequest } from './runtime-source-files';
import { runtimeContextProfile } from './runtime-context-budget';
import { type BrowserChatModelContextCompression } from './browser-chat-model-context';
import { notifyRuntimeToolTrace, runtimeToolTraceId } from './runtime-tool-trace';
import { normalizeBrowserChatSubagentTasks, type BrowserChatSubagentReadInput, type BrowserChatSubagentTask } from './browser-chat-subagent-task';
import { racePromiseWithAbort } from './browser-chat-interrupt-state';
import type { FileVisualInput as BrowserChatFileVisualInput } from '@cjfclonedeep/capability-sdk/file/node';
import { CodedError, ERROR_CODES, withErrorCode, getErrorCode } from '@cjfclonedeep/capability-sdk';


export type { BrowserChatSubagentTask } from './browser-chat-subagent-task';

type ExecutionDebug = (event: { phase: string; message: string; stepIndex?: number; details?: unknown }) => void | Promise<void>;

export type BrowserChatReadFileInput = FileReadInput;

export type BrowserChatReadSkill = (skillId: string) => Promise<BrowserActionResult>;

export type BrowserChatTextStreamUpdate = {
  agentStepIndex: number;
  delta: string;
  responseDraft?: { id: string; blocks: BrowserChatFinalBlock[] } | null;
  performance?: BrowserChatOutputPerformance;
  runtimeStepIndex: number;
  stepNumber: number;
  text: string;
};

export type BrowserChatReasoningStreamUpdate = ReasoningStreamUpdate & {
  agentStepIndex: number;
  runtimeStepIndex: number;
};

type ToolTrace = {
  id?: string;
  name: string;
  input: unknown;
  result?: BrowserActionResult;
  recovered?: boolean;
  transient?: boolean;
  invalid?: boolean;
  startedAt?: number;
  completedAt?: number;
  elapsedMs?: number;
  aiRequestElapsedMs?: number;
  actionElapsedMs?: number;
  executionError?: { name: string; message: string; stack?: string };
  postprocessTimings?: Record<string, number>;
  progress?: StepToolCall['progress'];
  contextBefore?: AiToolContextSnapshot;
  contextAfter?: AiToolContextSnapshot;
  screenshots?: Array<{
    source?: 'automatic' | 'explicit';
    title: string;
    path: string;
    kind?: 'current' | 'history' | 'pinned' | 'after' | 'marker' | 'original' | 'other';
  }>;
};

type BrowserChatSafetyMode = 'strict' | 'full';

export type BrowserToolConfirmationDecision = 'confirmed' | 'cancelled';

export type BrowserToolConfirmationRequest = {
  toolName: string;
  input: unknown;
  reason?: string;
  prompt: string;
  stepIndex?: number;
};

export type BrowserChatSubagentRunner = (
  tasks: BrowserChatSubagentTask[],
  abortSignal?: AbortSignal,
  toolCallId?: string,
) => Promise<BrowserActionResult>;

export type BrowserChatSubagentReader = (input: BrowserChatSubagentReadInput, abortSignal?: AbortSignal) => Promise<BrowserActionResult>;

export type BrowserChatSubagentResultSnapshot = {
  toolCallId: string;
  result: BrowserActionResult;
};

type BrowserChatRuntimeRecord = {
  description: string;
  targetUrl: string;
  systemPrompt: string;
};

type BrowserChatOperationalContext = {
  operationalContext: string;
  credentialBindings?: BrowserCodeCredentialBinding[];
  knowledge?: RuntimeKnowledgeBlock[];
  onKnowledgeSelected?: (entries: NonNullable<RuntimeContextManifest['knowledge']>) => Promise<void>;
};

// 判断当前模型配置是否支持图片输入；这只是模型能力判断，不代表一定会发送截图。
function modelSupportsImageInput() {
  return getModelSettings().supportsImageInput;
}

function finiteContextStat(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

function toolContextFromStats(
  stats: unknown,
  aiRequest?: Pick<AiRequestSnapshot, 'createdAt' | 'id'>,
): AiToolContextSnapshot | undefined {
  const record = recordFromUnknown(stats);
  const snapshot: AiToolContextSnapshot = {
    requestId: aiRequest?.id,
    requestCreatedAt: aiRequest?.createdAt,
    estimatedTotalTokens: finiteContextStat(record.estimatedTotalTokens),
    estimatedTextTokens: finiteContextStat(record.estimatedTextTokens),
    estimatedImageTokens: finiteContextStat(record.estimatedImageTokens),
    estimatedToolSchemaTokens: finiteContextStat(record.estimatedToolSchemaTokens),
    imageCount: finiteContextStat(record.imageCount),
    method: typeof record.method === 'string' ? record.method : undefined,
  };
  return Object.values(snapshot).some((value) => value !== undefined) ? snapshot : undefined;
}

function toolContextFromAiRequest(aiRequest?: AiRequestSnapshot): AiToolContextSnapshot | undefined {
  if (!aiRequest) return undefined;
  return toolContextFromStats(aiRequest.options?.modelContextStats, aiRequest);
}

// 是否启用视觉候选标识。关闭时仍发送截图，但候选元素只以文本摘要进入 prompt。

// Default to inline marker labels so visual mode screenshots show interactive targets.

// 将调试数据转成可安全 JSON 序列化的结构，避免 Buffer/BigInt 破坏持久化。
function jsonSafe(value: unknown) {
  if (value === undefined) return undefined;
  const ancestors: object[] = [];
  const serialized = JSON.stringify(value, function (this: object, _key, item) {
    if (typeof item === 'bigint') return item.toString();
    if (typeof item === 'function' || typeof item === 'symbol') return undefined;
    if (item instanceof Error) {
      return {
        name: item.name,
        message: item.message,
        stack: item.stack,
      };
    }
    if (Buffer.isBuffer(item)) return `[Buffer ${item.length} bytes]`;
    if (item instanceof ArrayBuffer) return `[ArrayBuffer ${item.byteLength} bytes]`;
    if (ArrayBuffer.isView(item)) return `[${item.constructor.name || 'TypedArray'} ${(item as ArrayBufferView).byteLength} bytes]`;
    if (item && typeof item === 'object') {
      while (ancestors.length && ancestors[ancestors.length - 1] !== this) ancestors.pop();
      if (ancestors.includes(item)) return '[Circular]';
      ancestors.push(item);
    }
    return item;
  });
  return serialized ? JSON.parse(serialized) : serialized;
}

// 纯标识图必须跟随原图最终发送尺寸缩放，否则两张图经过压缩后会失去像素对齐关系。

function trimDebugText(value: string, max = 4000) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function providerToolSchemaError(value?: string) {
  return /Failed to deserialize the JSON body|unknown variant `?custom`?|invalid_request_error|AnthropicException|litellm\.BadRequestError/i.test(value || '');
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const numberValue = typeof value === 'number' ? value : Number(value);
  const normalized = Number.isFinite(numberValue) ? Math.floor(numberValue) : fallback;
  return Math.min(Math.max(normalized, min), max);
}

function upstreamApiDisconnectReason(value?: string) {
  const text = value || '';
  const apiMatch = text.match(/Cannot connect to API:\s*([^\n]+)/i);
  if (apiMatch?.[1]) return apiMatch[1].trim();
  const genericMatch = text.match(/(?:other side closed|socket hang up|ECONNRESET|connection (?:closed|reset|terminated)|fetch failed)/i);
  return genericMatch?.[0];
}

function aiRequestFromError(error: unknown) {
  if (!error || typeof error !== 'object') return undefined;
  return (error as { aiRequest?: AiRequestSnapshot }).aiRequest;
}

function runtimeRetryFromError(error: unknown) {
  if (!error || typeof error !== 'object') return undefined;
  const retry = (error as { runtimeRetry?: unknown }).runtimeRetry;
  if (!retry || typeof retry !== 'object' || Array.isArray(retry)) return undefined;
  const record = retry as Record<string, unknown>;
  const retryAttempts = Number(record.retryAttempts);
  const maxRetryAttempts = Number(record.maxRetryAttempts);
  const consecutiveFailures = Number(record.consecutiveFailures ?? retryAttempts);
  const consecutiveFailureLimit = Number(record.consecutiveFailureLimit ?? maxRetryAttempts);
  if (!Number.isFinite(consecutiveFailures) || !Number.isFinite(consecutiveFailureLimit)) return undefined;
  const decision = record.decision && typeof record.decision === 'object' && !Array.isArray(record.decision)
    ? record.decision as Record<string, unknown>
    : undefined;
  return {
    consecutiveFailures: Math.max(0, Math.floor(consecutiveFailures)),
    consecutiveFailureLimit: Math.max(1, Math.floor(consecutiveFailureLimit)),
    retryable: decision?.retryable === true,
    category: typeof decision?.category === 'string' ? decision.category : undefined,
  };
}

function diagnosticValueText(value: unknown, max = 900) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value.trim() ? trimDebugText(value.trim(), max) : undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return trimDebugText(JSON.stringify(value), max);
  } catch {
    return trimDebugText(String(value), max);
  }
}

function aiRequestBrief(aiRequest?: AiRequestSnapshot) {
  if (!aiRequest) return undefined;
  const agentStepIndex = aiRequest.options?.agentStepIndex;
  return [
    aiRequest.id ? `requestId=${aiRequest.id}` : '',
    aiRequest.provider ? `provider=${aiRequest.provider}` : '',
    aiRequest.model ? `model=${aiRequest.model}` : '',
    `stepIndex=${aiRequest.stepIndex}`,
    typeof agentStepIndex === 'number' ? `agentStep=${agentStepIndex}` : '',
  ].filter(Boolean).join(', ');
}

function upstreamDisconnectLines(
  reason: string,
  text: string,
  context?: { error?: unknown; aiRequest?: AiRequestSnapshot },
) {
  const error = context?.error;
  const aiRequest = context?.aiRequest || aiRequestFromError(error);
  const requestBrief = aiRequestBrief(aiRequest);
  const retryInfo = runtimeRetryFromError(error);
  const code = firstErrorString(error, 'code');
  const status = firstErrorValue(error, 'status') ?? firstErrorValue(error, 'statusCode');
  const causeMessage = errorCauseMessage(error);
  const responseBody = firstErrorDisplay(error, 'responseBody', 1200)
    || firstErrorDisplay(error, 'body', 1200)
    || firstErrorDisplay(error, 'data', 1200);
  const technical = [
    code ? `code=${code}` : '',
    status !== undefined ? `status=${diagnosticValueText(status, 120)}` : '',
    causeMessage ? `cause=${trimDebugText(causeMessage, 600)}` : '',
    responseBody ? `responseBody=${responseBody}` : '',
  ].filter(Boolean).join('; ');
  const raw = trimDebugText(text, 1200);
  const lines = [
    `网关返回原因：${reason}`,
    requestBrief ? `请求信息：${requestBrief}` : '',
    retryInfo ? `重试信息：连续失败 ${retryInfo.consecutiveFailures} 次，达到上限 ${retryInfo.consecutiveFailureLimit} 次；仍然失败。` : '',
    technical ? `技术细节：${technical}` : '',
    raw ? `原始错误：${raw}` : '',
  ].filter(Boolean);
  if (!code && status === undefined && !causeMessage && !responseBody) {
    lines.push('补充：上游只返回了连接被对端关闭，未返回 HTTP 状态码或响应体。');
  }
  return lines;
}

function userFacingInfrastructureError(value?: string, context?: { error?: unknown; aiRequest?: AiRequestSnapshot }) {
  const text = value || '';
  const retryInfo = runtimeRetryFromError(context?.error);
  if (retryInfo?.category === 'billing' || isProviderBillingLimitMessage(text)) {
    const status = firstErrorValue(context?.error, 'status') ?? firstErrorValue(context?.error, 'statusCode') ?? 429;
    const reason = trimDebugText(text.split(/\r?\n/, 1)[0] || text, 600);
    return `上游 AI 服务返回 ${status}：${reason}\n这是套餐或额度耗尽，不会进行无效重试。本轮操作已停止，当前页面状态已保留。`;
  }
  const upstreamReason = upstreamApiDisconnectReason(text);
  if (upstreamReason) {
    return [
      '上游 AI 服务连接已断开。',
      ...upstreamDisconnectLines(upstreamReason, text, context),
      '本轮操作已停止，当前页面状态已保留。',
    ].join('\n');
  }
  if (/AI SDK returned retryable finish reason "(?:error|other)"/i.test(text)) {
    const attempts = retryInfo
      ? `连续 ${retryInfo.consecutiveFailures} 次，达到上限 ${retryInfo.consecutiveFailureLimit} 次`
      : '达到请求级重试上限';
    return `AI SDK ${attempts}返回错误结束状态。本轮操作已停止，当前页面状态已保留。`;
  }
  if (providerToolSchemaError(text)) return 'AI 模型请求失败：当前模型网关不兼容本轮工具调用格式。本轮操作已停止，当前页面状态已保留。';
  if (/Request aborted|operation interrupted/i.test(text)) return '本轮 AI 请求被中断，未继续写入技术错误。';
  if (/timed out|timeout/i.test(text)) return 'AI 请求在请求级重试后仍然超时。本轮操作已停止，当前页面状态已保留。';
  if (/No capacity available|rate limit/i.test(text)) return 'AI 服务在请求级重试后仍然不可用。本轮操作已停止，当前页面状态已保留。';
  return 'AI 请求或响应处理在请求级重试后仍然失败。本轮操作已停止，当前页面状态已保留。';
}

function userFacingToolResult(name: string, result?: BrowserActionResult, _max = 360) {
  void _max;
  if (!result) return undefined;
  const summary = browserOperationSummary(result);
  if (!result.ok && providerToolSchemaError(summary)) return userFacingInfrastructureError(summary);
  if (name === 'file') return formatFileArtifactResult(name, result.actual) ?? summary;
  return summary;
}

function compactToolResultForModel(
  name: string,
  result: BrowserActionResult,
  input?: unknown,
): BrowserActionResult {
  const action = input && typeof input === 'object' && !Array.isArray(input)
    ? String((input as Record<string, unknown>).action || '')
    : '';
  const modelResult = { ...result };
  delete modelResult.snapshotId;
  if (name === 'browser' && action === 'code') delete modelResult.observation;
  if (modelResult.domChanges) {
    modelResult.domChanges = { ...modelResult.domChanges };
    delete modelResult.domChanges.snapshotId;
    if (name === 'browser' && action === 'code') delete modelResult.domChanges.observation;
  }
  delete modelResult.referenceImagePath;
  delete modelResult.referenceImagePaths;
  const browserObservation = modelResult.browserObservation;
  delete modelResult.browserObservation;
  if (name === 'browser' && action === 'code' && modelResult.data && typeof modelResult.data === 'object' && !Array.isArray(modelResult.data)) {
    const data = { ...(modelResult.data as Record<string, unknown>) };
    const result = data.result && typeof data.result === 'object' && !Array.isArray(data.result)
      ? data.result as Record<string, unknown> : undefined;
    const finalPage = data.finalPage && typeof data.finalPage === 'object' && !Array.isArray(data.finalPage)
      ? data.finalPage as Record<string, unknown> : undefined;
    if (result && finalPage && result.url === finalPage.url && result.title === finalPage.title) delete data.finalPage;
    const observation = data.observation && typeof data.observation === 'object' && !Array.isArray(data.observation)
      ? data.observation as Record<string, unknown> : browserObservation;
    if (observation) data.observation = {
      status: observation.status,
      ...(observation.error ? { error: observation.error } : {}),
      ...(observation.disabledReason ? { disabledReason: observation.disabledReason } : {}),
    };
    modelResult.data = data;
    if (modelResult.ok && data.result !== undefined) delete modelResult.summary;
  }
  if (!modelResult.actual) return modelResult;
  // The trace/database retain the complete raw result. The model only needs a
  // compact, actionable representation; otherwise repeated Office validation
  // payloads and stack traces quickly dominate the conversation context.
  const fileResult = formatFileArtifactResult(name, modelResult.actual);
  if (fileResult) return { ...modelResult, actual: fileResult };
  if (name === 'file' && action === 'visualReport') {
    try {
      const payload = JSON.parse(modelResult.actual) as Record<string, unknown>;
      const kind = String(payload.kind || '');
      if (kind === 'file-visual-report') {
        const reviews = Array.isArray(payload.reviews) ? payload.reviews : [];
        return {
          ...modelResult,
          actual: JSON.stringify({
            kind,
            artifactId: payload.artifactId,
            fileName: payload.fileName,
            reportedScreenshotIds: reviews.flatMap((review) => (
              review && typeof review === 'object' && typeof (review as { screenshotId?: unknown }).screenshotId === 'string'
                ? [(review as { screenshotId: string }).screenshotId]
                : []
            )),
            reportedCount: reviews.length,
            instruction: payload.instruction,
            visualQa: payload.visualQa,
          }),
        };
      }
    } catch {
      // Keep the original result when this is not a structured visual-report payload.
    }
  }
  return modelResult;
}

function elapsedSince(startedAt: number) {
  return Date.now() - startedAt;
}

// 拆分工具参数和 AI 给出的调用原因，便于历史步骤里单独展示。
function splitToolInputAndReason(input: unknown) {
  const safeInput = jsonSafe(input);
  if (!safeInput || typeof safeInput !== 'object' || Array.isArray(safeInput)) {
    return { input: safeInput, reason: undefined };
  }
  const { reason, ...rest } = safeInput as Record<string, unknown>;
  const compactInput = Object.keys(rest).length ? rest : undefined;
  return {
    input: compactInput,
    reason: typeof reason === 'string' && reason.trim() ? trimDebugText(reason.trim(), 300) : undefined,
  };
}

async function requestBrowserToolApproval(input: {
  toolName: string;
  toolInput: unknown;
  stepIndex?: number;
  request?: (request: BrowserToolConfirmationRequest) => Promise<BrowserToolConfirmationDecision>;
}) {
  if (!input.request) return 'not-applicable' as const;
  const approval = browserToolApprovalRequest({
    toolName: input.toolName,
    toolInput: input.toolInput,
  });
  if (!approval) return 'not-applicable' as const;
  const decision = await input.request({
    toolName: input.toolName,
    input: input.toolInput,
    reason: approval.reason,
    prompt: approval.prompt,
    stepIndex: input.stepIndex,
  });
  return decision === 'confirmed' ? 'approved' as const : 'denied' as const;
}

function parseJsonObjectText(text?: string) {
  const trimmed = (text || '').trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith('{') && !trimmed.startsWith('```')) return undefined;
  try {
    const parsed = extractJson(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function browserChatAbortError(signal?: AbortSignal) {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  return new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Browser chat operation interrupted by user.');
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw browserChatAbortError(signal);
}

function throwIfStopped(signal?: AbortSignal, shouldContinue?: () => boolean) {
  throwIfAborted(signal);
  if (shouldContinue && !shouldContinue()) throw browserChatAbortError(signal);
}

// 从模型回复中提取 JSON，兼容模型把 JSON 包在 markdown 代码块里的情况。
function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] || text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'AI did not return JSON.');
  return JSON.parse(raw.slice(start, end + 1));
}

// 将测试需求富文本转为纯文本，作为执行器理解目标的主输入。
function recordFromUnknown(value: unknown): Record<string, unknown> {
  return jsonRecordFromUnknown(value) ?? {};
}

function systemPromptOf(runtimeRecord: BrowserChatRuntimeRecord) {
  return richTextToPlainText(runtimeRecord.systemPrompt || '').trim();
}

// 将浏览器工具调用轨迹压缩为步骤证据，保存到运行历史中。
function summarizeToolTraces(traces: ToolTrace[]): StepToolCall[] {
  return traces.map((trace) => {
    const { input, reason } = splitToolInputAndReason(trace.input);
    return {
      id: trace.id,
      name: trace.name,
      input,
      reason,
      ok: trace.result?.ok,
      invalid: trace.invalid,
      recovered: trace.recovered,
      transient: trace.transient,
      result: userFacingToolResult(trace.name, trace.result, 360),
      error: trace.result?.ok === false ? trace.executionError?.message || userFacingToolResult(trace.name, trace.result, 360) : undefined,
      rawResult: trace.executionError && trace.result ? { ...trace.result, executionError: trace.executionError } : trace.result,
      elapsedMs: trace.elapsedMs,
      aiRequestElapsedMs: trace.aiRequestElapsedMs,
      progress: trace.progress,
      contextBefore: trace.contextBefore,
      contextAfter: trace.contextAfter,
      screenshots: trace.screenshots,
    };
  });
}

function browserChatFinalResponseCompletionError(response: StructuredResponse) {
  const completion = response.completion;
  if (!completion) return 'finalResponse requires completion: { complete, remainingWork: string[] }. Check the active user request before ending the turn.';
  if (!completion.complete) {
    return 'finalResponse cannot end an incomplete request, regardless of status or model-declared blockers. Continue all feasible work now; a time/step budget, a new login, a prerequisite you can create, or a different interaction method is not an external blocker. Use waitForHumanVerification for user-owned browser verification or requestUserInput for essential user-owned information only after independent work is complete; report an actual runtime failure accurately.';
  }
  if (completion.remainingWork.length) {
    return 'finalResponse says the request is complete but also lists remaining work. Continue the feasible work; do not end this turn or ask the user whether to continue.';
  }
  if (response.status === 'blocked') return 'A blocked response cannot declare the active request complete.';
  return undefined;
}

function subagentHumanPauseReply(snapshots: readonly BrowserChatSubagentResultSnapshot[]) {
  const children = snapshots.flatMap(snapshot => {
    const actual = parseJsonObjectText(snapshot.result.actual);
    return Array.isArray(actual?.subagents) ? actual.subagents.map(recordFromUnknown)
      .filter(child => child.status === 'blocked' && child.resumable === true) : [];
  });
  const replies = children.map(child => {
    const text = [child.question, child.summary, child.content]
      .find(value => typeof value === 'string' && value.trim()) as string | undefined;
    const reply = text || '子 Agent 正在等待人工处理，请完成其请求后继续。';
    return children.length > 1 && typeof child.title === 'string' && child.title.trim()
      ? `子 Agent「${child.title}」：\n\n${reply}` : reply;
  });
  return replies.length ? replies.join('\n\n') : undefined;
}

function subagentHumanPauseReplyFromTraces(traces: readonly ToolTrace[]) {
  const latest = new Map<string, Record<string, unknown>>();
  for (const trace of traces) {
    if (trace.name !== 'subagent' || !trace.result?.ok) continue;
    const actual = subagentResultActual(trace.result);
    if (Array.isArray(actual.subagents)) for (const value of actual.subagents) {
      const child = recordFromUnknown(value);
      if (typeof child.uuid === 'string') latest.set(child.uuid, child);
    }
    if (actual.action === 'read' && typeof actual.uuid === 'string') latest.set(actual.uuid, actual);
  }
  return subagentHumanPauseReply([{ toolCallId: 'child-results', result: { ok: true,
    actual: JSON.stringify({ subagents: [...latest.values()] }) } }]);
}

function imageTokenEstimatePerImage() {
  return runtimeContextProfile(getModelSettings()).imageTokens;
}

class VisualContextManager {
  private frames: VisualFrameRecord[] = [];
  private archive = new Map<string, VisualFrameRecord>();
  private currentId?: string;
  private sequence = 0;

  constructor(private readonly maxHistory = Math.max(0, Math.min(3, Math.floor(9000 / Math.max(1, imageTokenEstimatePerImage())) - 1, boundedInteger(runtimeSetting('AI_VISUAL_HISTORY_LIMIT'), 3, 0, 3)))) {}

  append(frame: Omit<VisualFrameRecord, 'id' | 'role' | 'createdAt'>, mode: 'replace' | 'append' | 'keep-pair' | 'refresh' = 'replace') {
    if (this.current()?.path === frame.path) return this.current()!;
    if (frame.toolName === 'browser') {
      const previous = this.frames.findLast(item => item.toolName === 'browser');
      this.frames = this.frames.filter(item => item.toolName !== 'browser'
        || (mode === 'keep-pair' && item.id === previous?.id)
        || (mode === 'append' && item.url === frame.url && item.surfaceId === frame.surfaceId)
        || (mode === 'refresh' && item.id !== previous?.id && item.url === frame.url && item.surfaceId === frame.surfaceId));
    }
    this.demoteCurrent();
    const record = this.createFrame(frame, 'current');
    this.frames.push(record);
    this.archive.set(record.id, record);
    this.currentId = record.id;
    this.trim();
    return record;
  }

  restore(value: unknown) {
    const state = value as { current?: VisualFrameRecord; history?: VisualFrameRecord[]; available?: VisualFrameRecord[] };
    this.frames = [...(state.history || []), ...(state.current ? [state.current] : [])];
    this.currentId = state.current?.id;
    this.archive = new Map([...(state.available || []), ...this.frames].map(frame => [frame.id, frame]));
    this.trim();
  }

  select(ids: string[]) {
    if (ids.some(id => !this.archive.has(id))) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Unknown image in this session.');
    const current = this.current();
    this.frames = [...ids.filter(id => id !== this.currentId).map(id => ({ ...this.archive.get(id)!, role: 'history' as const })), ...(current ? [current] : [])];
    this.trim();
    return this.snapshot();
  }

  clearCurrent() {
    this.demoteCurrent();
    this.currentId = undefined;
  }

  current() {
    return this.frames.find((frame) => frame.id === this.currentId);
  }

  snapshot() {
    return {
      current: this.current(),
      history: this.frames.filter((frame) => frame.id !== this.currentId),
    };
  }

  persisted() { return { ...this.snapshot(), available: [...this.archive.values()] }; }

  private createFrame(frame: Omit<VisualFrameRecord, 'id' | 'role' | 'createdAt'>, role: VisualFrameRecord['role']) {
    this.sequence += 1;
    return {
      ...frame,
      id: frame.observationId || `vf-${this.sequence}`,
      role,
      createdAt: new Date().toISOString(),
    };
  }

  private demoteCurrent() {
    this.frames = this.frames.map((frame) => frame.id === this.currentId && frame.role === 'current'
      ? { ...frame, role: 'history' }
      : frame);
  }

  private trim() {
    const pinned = this.frames.filter((frame) => frame.role === 'pinned');
    const current = this.current();
    const history = this.frames
      .filter((frame) => frame.role !== 'pinned' && frame.id !== this.currentId)
      .slice(-this.maxHistory);
    this.frames = [...history, ...pinned, ...(current ? [current] : [])];
  }
}

const internalReferenceImageToolNames = new Set([
  'file',
]);

function createToolTrace(input: {
  traces: ToolTrace[];
  name: string;
  toolInput: unknown;
  toolCallId?: string;
  aiRequest?: AiRequestSnapshot;
  aiRequestElapsedMs?: number;
  runId?: string;
  stepIndex?: number;
}) {
  const { traces, name, toolInput, toolCallId, aiRequest, aiRequestElapsedMs, runId, stepIndex } = input;
  const existing = toolCallId ? traces.find((trace) => trace.id === toolCallId) : undefined;
  if (existing) {
    existing.name = name;
    existing.input = toolInput;
    existing.startedAt ??= Date.now();
    existing.aiRequestElapsedMs ??= aiRequestElapsedMs;
    existing.contextBefore ??= toolContextFromAiRequest(aiRequest);
    existing.screenshots ??= [];
    return existing;
  }
  const screenshots: ToolTrace['screenshots'] = [];
  const traceId = toolCallId || runtimeToolTraceId({ runId, stepIndex, traceIndex: traces.length + 1 });
  const trace: ToolTrace = {
    id: traceId,
    name,
    input: toolInput,
    startedAt: Date.now(),
    aiRequestElapsedMs,
    contextBefore: toolContextFromAiRequest(aiRequest),
    screenshots,
  };
  traces.push(trace);
  return trace;
}

async function finalizeToolTraceVisuals(input: {
  trace: ToolTrace;
  result: BrowserActionResult;
  stepIndex?: number;
  visualContext?: VisualContextManager;
  abortSignal?: AbortSignal;
  shouldContinue?: () => boolean;
  onVisualContextChange?: (snapshot: ReturnType<VisualContextManager['snapshot']>) => void | Promise<void>;
}) {
  const { trace, stepIndex, visualContext, abortSignal, shouldContinue, onVisualContextChange } = input;
  throwIfStopped(abortSignal, shouldContinue);
  const result = input.result;
  const screenshots: NonNullable<ToolTrace['screenshots']> = [];
  const emittedImagePaths = result.referenceImagePaths?.length
    ? result.referenceImagePaths
    : result.referenceImagePath ? [result.referenceImagePath] : [];
  const currentImagePath = result.browserObservation?.status === 'available' ? result.browserObservation.path : undefined;
  if (!internalReferenceImageToolNames.has(trace.name)) {
    for (const [index, imagePath] of emittedImagePaths.entries()) {
      // Automatic observations belong to model context, not tool attachments.
      if (imagePath === result.browserObservation?.path) continue;
      if (!screenshots.some((item) => item.path === imagePath)) {
        screenshots.push({
          source: 'explicit',
          title: `${trace.name} explicit image ${index + 1}`,
          path: imagePath,
          kind: index === emittedImagePaths.length - 1 && result.browserObservation?.status !== 'unavailable' ? 'current' : 'history',
        });
      }
    }
  }
  if (result.browserObservation && result.browserObservation.status !== 'available' && visualContext) {
    visualContext.clearCurrent();
    await onVisualContextChange?.(visualContext.snapshot());
  }
  if ((result.browserObservation ? result.browserObservation.status === 'available' : result.ok) && (currentImagePath || emittedImagePaths.length) && visualContext) {
    const toolInput = trace.input && typeof trace.input === 'object' && !Array.isArray(trace.input)
      ? trace.input as Record<string, unknown>
      : {};
    const capture = toolInput.capture === 'fullPage' ? 'fullPage' : 'viewport';
    visualContext.append({
      path: currentImagePath || emittedImagePaths.at(-1) || emittedImagePaths[0],
      stepIndex: stepIndex || 0,
      toolName: trace.name,
      capture,
      url: result.browserObservation?.url,
      observationId: result.browserObservation?.id, surfaceId: result.browserObservation?.surfaceId,
      reason: result.browserObservation ? 'Latest browser viewport after code execution' : `${trace.name} explicit visual evidence`,
    }, result.ok === false ? 'keep-pair' : toolInput.observationMode === 'append' || toolInput.observationMode === 'keep-pair' ? toolInput.observationMode : 'replace');
    await onVisualContextChange?.(visualContext.snapshot());
  }

  trace.result = result;
  trace.screenshots = screenshots;
  return result;
}

async function executeTracedBrowserAction(input: {
  traces: ToolTrace[];
  name: string;
  toolInput: unknown;
  toolCallId?: string;
  action: (abortSignal?: AbortSignal, trace?: ToolTrace) => Promise<BrowserActionResult>;
  aiRequest?: AiRequestSnapshot;
  aiRequestElapsedMs?: number;
  runId?: string;
  stepIndex?: number;
  visualContext?: VisualContextManager;
  abortSignal?: AbortSignal;
  shouldContinue?: () => boolean;
  onToolTrace?: (trace: ToolTrace) => void | Promise<void>;
  onVisualContextChange?: (snapshot: ReturnType<VisualContextManager['snapshot']>) => void | Promise<void>;
  loadedHiddenRuntimeSkillIds?: Set<string>;
}) {
  const { traces, name, toolInput, toolCallId, action, aiRequest, aiRequestElapsedMs, runId, stepIndex, visualContext, abortSignal, shouldContinue, onToolTrace, onVisualContextChange } = input;
  throwIfStopped(abortSignal, shouldContinue);
  const trace = createToolTrace({ traces, name, toolInput, toolCallId, aiRequest, aiRequestElapsedMs, runId, stepIndex });
  const postprocessTimings: Record<string, number> = {};
  trace.postprocessTimings = postprocessTimings;
  let postprocessStartedAt = Date.now();
  await notifyRuntimeToolTrace(onToolTrace, trace);
  postprocessTimings.notifyStartMs = elapsedSince(postprocessStartedAt);
  throwIfStopped(abortSignal, shouldContinue);

  let result: BrowserActionResult;
  const actionStartedAt = Date.now();
  const runtimeSkill = input.loadedHiddenRuntimeSkillIds
    ? hiddenRuntimeSkillForToolCall(name, toolInput, input.loadedHiddenRuntimeSkillIds) : undefined;
  const skillFailure = input.loadedHiddenRuntimeSkillIds
    ? requireHiddenRuntimeSkillRead(name, toolInput, input.loadedHiddenRuntimeSkillIds) : undefined;
  const withRuntimeSkill = (result: BrowserActionResult): BrowserActionResult => runtimeSkill
    ? { ...result, runtimeSkill } : result;
  const actionPromise = Promise.resolve().then(() => skillFailure || action(abortSignal, trace));
  try {
    result = await racePromiseWithAbort(actionPromise, abortSignal);
    throwIfStopped(abortSignal, shouldContinue);
  } catch (error) {
    if (abortSignal?.aborted || (shouldContinue && !shouldContinue())) {
      // Some renderer/converter processes cannot be cancelled once their
      // final write has begun. Preserve a later successful artifact result so
      // the interrupted message can receive it through realtime state instead
      // of discovering the file only after a full page refresh.
      void actionPromise.then(async (lateResult) => {
        trace.result = withToolFailureGuidance(name, withRuntimeSkill(lateResult));
        trace.actionElapsedMs = elapsedSince(actionStartedAt);
        trace.completedAt = Date.now();
        trace.elapsedMs = trace.startedAt ? trace.completedAt - trace.startedAt : undefined;
        await notifyRuntimeToolTrace(onToolTrace, trace);
      }).catch(() => undefined);
      throw browserChatAbortError(abortSignal);
    }
    trace.executionError = error instanceof Error
      ? { ...codexRuntimeError(error), name: error.name, message: error.message, stack: error.stack?.slice(0, 12_000) }
      : { ...codexRuntimeError(error), name: 'Error', message: String(error) };
    result = {
      ok: false,
      code: getErrorCode(error, ERROR_CODES.CAPABILITY_EXECUTION_FAILED),
      actual: `Tool ${name} threw after execution started: ${infrastructureError(error)}`,
    };
  }
  result = withErrorCode(withToolFailureGuidance(name, withRuntimeSkill(result)), ERROR_CODES.CAPABILITY_EXECUTION_FAILED);
  trace.actionElapsedMs = elapsedSince(actionStartedAt);

  throwIfStopped(abortSignal, shouldContinue);
  trace.result = result;
  postprocessStartedAt = Date.now();
  result = await finalizeToolTraceVisuals({
    trace,
    result,
    stepIndex,
    visualContext,
    abortSignal,
    shouldContinue,
    onVisualContextChange,
  });
  postprocessTimings.visualContextMs = elapsedSince(postprocessStartedAt);
  throwIfStopped(abortSignal, shouldContinue);
  trace.completedAt = Date.now();
  trace.elapsedMs = trace.startedAt ? trace.completedAt - trace.startedAt : undefined;
  postprocessStartedAt = Date.now();
  await notifyRuntimeToolTrace(onToolTrace, trace);
  postprocessTimings.notifyCompleteMs = elapsedSince(postprocessStartedAt);
  trace.completedAt = Date.now();
  trace.elapsedMs = trace.startedAt ? trace.completedAt - trace.startedAt : undefined;
  return result;
}

function browserCodeScreenshotFileNames(paths: string[]) {
  return [...new Set(paths.map((filePath) => filePath.replace(/\\/g, '/').split('/').at(-1)?.trim() || '').filter(Boolean))];
}

async function makeBrowserTools(
  session: BrowserSession,
  traces: ToolTrace[],
  aiRequest?: AiRequestSnapshot,
  onToolTrace?: (trace: ToolTrace) => void | Promise<void>,
  referenceOptions?: {
  browserInteractionMode?: BrowserChatInteractionMode;
    runId?: string;
    sessionId?: string;
    userId?: string;
    stepIndex?: number;
    allowedToolTypes?: string[];
    disabledTools?: string[];
    visualContext?: VisualContextManager;
    getAiRequest?: () => AiRequestSnapshot | undefined;
    archiveResult?: (name: string, id: string, result: BrowserActionResult) => Promise<string>;
    validateFinalResponse: (response: StructuredResponse) => Promise<string | undefined>;
    getAiRequestElapsedMs?: (toolCallId?: string) => number | undefined;
    abortSignal?: AbortSignal;
    shouldContinue?: () => boolean;
    onDebug?: ExecutionDebug;
    onVisualContextChange?: (snapshot: ReturnType<VisualContextManager['snapshot']>) => void | Promise<void>;
    requestToolConfirmation?: (request: BrowserToolConfirmationRequest) => Promise<BrowserToolConfirmationDecision>;
    runSubagents?: BrowserChatSubagentRunner;
    readSubagentResult?: BrowserChatSubagentReader;
    readFile?: (input: BrowserChatReadFileInput, context?: import('@cjfclonedeep/capability-sdk').CapabilityExecutionContext) => Promise<BrowserActionResult>;
    readFileVisuals?: (input: BrowserChatFileVisualInput) => Promise<BrowserActionResult>;
    readSkill?: BrowserChatReadSkill;
    onReferenceImage?: (input: { path: string; source: string; label?: string }) => void;
    ensureBrowserStarted?: (signal?: AbortSignal) => Promise<void>;
    attachmentBindings?: BrowserCodeAttachmentBinding[];
    credentialBindings?: BrowserCodeCredentialBinding[];
    getCredentialBindings?: () => BrowserCodeCredentialBinding[] | undefined;
    loadedHiddenRuntimeSkillIds?: Set<string>;
  },
) {
  const imageInputAvailable = modelSupportsImageInput();
  // Browser and document mutations stay ordered. Consecutive download calls are
  // independent and run as one concurrent batch; the next stateful tool waits
  // for that complete batch before it starts.
  let toolExecutionQueue = Promise.resolve();
  const activeConcurrentDownloads = new Set<Promise<BrowserActionResult>>();
  const loadedHiddenRuntimeSkillIds = referenceOptions?.loadedHiddenRuntimeSkillIds || new Set<string>();
  const toolReasonInput = z.string().min(1).max(300).describe('Concise Chinese reason for this call: the requested target, missing evidence or expected outcome. Do not paste tool arguments or internal identifiers as the reason.');
  const toolContextShape = {
    reason: toolReasonInput,
  };
  const withToolInputExamples = <TSchema extends z.ZodType>(
    schema: TSchema,
    examples: readonly Record<string, unknown>[],
  ): TSchema => {
    if (!examples.length) return schema;
    const exampleDescription = examples
      .map((example, index) => `Example ${index + 1}: ${JSON.stringify(example)}`)
      .join(' ');
    return schema
      .describe(`Valid tool parameter examples. ${exampleDescription}`)
      .meta({ examples: examples.map((example) => ({ ...example })) }) as TSchema;
  };
  const browserToolInput = <T extends z.ZodRawShape>(
    shape: T,
    examples: readonly Record<string, unknown>[] = [],
  ) => withToolInputExamples(z.object({ ...toolContextShape, ...shape }), examples);
  const fileProgressReporter = (trace?: ToolTrace) => async (progress: CapabilityProgressEvent) => {
    if (!trace) return;
    trace.progress = {
      ...progress,
      elapsedMs: trace.startedAt ? Date.now() - trace.startedAt : undefined,
    };
    await notifyRuntimeToolTrace(onToolTrace, trace);
  };
  async function record(
    name: string,
    input: unknown,
    action: (abortSignal?: AbortSignal, trace?: ToolTrace) => Promise<BrowserActionResult>,
    execution?: { abortSignal?: AbortSignal; toolCallId?: string },
  ) {
    const run = async () => {
      throwIfStopped(referenceOptions?.abortSignal, referenceOptions?.shouldContinue);
      const actionWithCancellation = async (actionSignal?: AbortSignal, trace?: ToolTrace) => {
        if (!isRuntimeToolEnabled(name, runtimeConfiguration())) {
          return { ok: false, actual: `Tool ${name} is unavailable under the deployment permissions or tool settings. No action was executed.` } satisfies BrowserActionResult;
        }
        // Preserve the SDK's per-tool deadline as well as turn cancellation.
        // Let the action settle after cancellation so child batches can return
        // their result UUIDs and retained progress to the parent.
        const signal = execution?.abortSignal
          ? actionSignal ? AbortSignal.any([actionSignal, execution.abortSignal]) : execution.abortSignal
          : actionSignal;
        return action(signal, trace);
      };
      const traceVisualContext = referenceOptions?.visualContext;
      return executeTracedBrowserAction({
        traces,
        name,
        toolInput: input,
        toolCallId: execution?.toolCallId,
        runId: referenceOptions?.runId,
        stepIndex: referenceOptions?.stepIndex,
        visualContext: traceVisualContext,
        abortSignal: referenceOptions?.abortSignal,
        shouldContinue: referenceOptions?.shouldContinue,
        aiRequest: referenceOptions?.getAiRequest?.() || aiRequest,
        aiRequestElapsedMs: referenceOptions?.getAiRequestElapsedMs?.(execution?.toolCallId),
        onToolTrace,
        onVisualContextChange: traceVisualContext ? referenceOptions?.onVisualContextChange : undefined,
        action: actionWithCancellation,
        loadedHiddenRuntimeSkillIds: name === 'browser' ? undefined : loadedHiddenRuntimeSkillIds,
      }).then(async (result) => {
        const imagePaths = [...new Set([
          ...(result.referenceImagePaths?.length ? result.referenceImagePaths : result.referenceImagePath ? [result.referenceImagePath] : []),
          ...(result.browserObservation?.status === 'available' && result.browserObservation.path ? [result.browserObservation.path] : []),
        ])];
        const action = input && typeof input === 'object' && 'action' in input
          ? String((input as { action?: unknown }).action || '')
          : '';
        const source = name === 'file' && action
          ? `${name}:${action}`
          : name;
        const screenshotIds = name === 'file' && action === 'visualRead' && input && typeof input === 'object' && 'screenshotIds' in input
          ? (input as { screenshotIds?: unknown }).screenshotIds
          : undefined;
        // A render can produce every page preview at once. Those files are
        // indexed evidence, not implicit model attachments: visualRead attaches
        // only the requested pages in bounded batches.
        if (!(name === 'file' && action === 'render')) {
          for (const [index, path] of [...new Set(imagePaths)].entries()) {
            if (name === 'browser' && path === result.browserObservation?.path) continue;
            const screenshotId = Array.isArray(screenshotIds) && typeof screenshotIds[index] === 'string'
              ? screenshotIds[index]
              : undefined;
            const fileInput = name === 'file' && input && typeof input === 'object'
              ? input as Record<string, unknown> : undefined;
            const artifactLabel = fileInput?.artifactId || fileInput?.attachmentId || fileInput?.documentId;
            referenceOptions?.onReferenceImage?.({
              path, source: name === 'browser' ? 'browser:explicit' : screenshotId ? `${source}:${screenshotId}` : source,
              label: artifactLabel ? `${String(artifactLabel)}${screenshotId ? ` / ${screenshotId}` : ` / image ${index + 1}`}` : undefined,
            });
          }
        }
        const resultForModel = name === 'browser' && imagePaths.length
          ? { ...result, screenshotFileNames: browserCodeScreenshotFileNames(imagePaths),
            screenshotArtifacts: [...new Set(imagePaths)].flatMap(path => {
              const url = artifactApiUrl(path);
              return url ? [{ fileName: browserCodeScreenshotFileNames([path])[0], url }] : [];
            }) }
          : result;
        const ref = execution?.toolCallId ? await referenceOptions?.archiveResult?.(name, execution.toolCallId, result) : undefined;
        const sourceFile = sourceFileRequest(name, input);
        return { ...compactToolResultForModel(name, resultForModel, input), ...(ref ? { sourceRef: ref, readWith: contextReadToolName } : {}),
          ...(sourceFile ? { sourceFile } : {}) };
      });
    };
    const inputAction = input && typeof input === 'object' && 'action' in input
      ? String((input as { action?: unknown }).action || '')
      : '';
    const concurrentDownload = name === 'file' && inputAction === 'download';
    if (concurrentDownload) {
      const pending = toolExecutionQueue.then(run, run);
      activeConcurrentDownloads.add(pending);
      pending.finally(() => activeConcurrentDownloads.delete(pending)).catch(() => undefined);
      return pending;
    }
    // Code Sandbox has its own bounded concurrency in the selected backend.
    // Keep independent computations from being serialized behind browser/file
    // operations so parallel tool calls can reach that limit as intended.
    if (name === 'codeSandbox') return run();
    const precedingDownloads = [...activeConcurrentDownloads];
    const waitForDownloads = () => Promise.allSettled(precedingDownloads).then(() => undefined);
    const queued = toolExecutionQueue.then(waitForDownloads, waitForDownloads).then(run, run);
    toolExecutionQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  const infrastructureProviders = await createAgentInfrastructureProviders({
    attachmentBindings: referenceOptions?.attachmentBindings,
    userId: referenceOptions?.userId,
  });
  const allowedCapabilityToolNames = new Set(
    (referenceOptions?.allowedToolTypes ?? nativeRuntimeToolNames()).filter(name => !referenceOptions?.disabledTools?.includes(name) && isRuntimeToolEnabled(name, runtimeConfiguration())),
  );
  const managedProviders = await createManagedToolProviders({
    allowed: allowedCapabilityToolNames, userId: referenceOptions?.userId || '',
    attachments: referenceOptions?.attachmentBindings,
    credentials: referenceOptions?.getCredentialBindings || referenceOptions?.credentialBindings,
    sourcePageUrl: () => session.currentUrl(),
    sessionId: referenceOptions?.sessionId || referenceOptions?.runId || '', runId: referenceOptions?.runId || '',
    async beforeCall(id, _args, context): Promise<Record<string, string> | undefined> {
      if (id === 'knowledge') return { CAPABILITY_KNOWLEDGE_DIR: sharedKnowledgeDirectory(), CAPABILITY_KNOWLEDGE_READ_ONLY: 'true' };
      if (id === 'file') return { CAPABILITY_VISUAL_INPUT_AVAILABLE: String(imageInputAvailable) };
      if (id !== 'browser') return;
      const violation = _args.action === 'code' ? browserCodeServiceFileDeliveryViolation(String(_args.code || '')) : undefined;
      if (violation) throw new Error(violation);
      const component = toolInstaller().installed(id);
      const configuration = (await managedToolConfigurations())[id];
      session.configure({ ...runtimeConfiguration(), ...configuration?.env,
        ...await managedToolRuntimeConfiguration(id, configuration?.config || {}, process.cwd(), { ...runtimeConfiguration(), ...configuration?.env }),
        ...(component ? { CAPABILITY_RUNTIME_HOME: component.runtimeDirectory } : {}) });
      await referenceOptions?.ensureBrowserStarted?.(context.abortSignal);
      const connection = await session.browserAutomationTarget();
      return { BROWSER_ISOLATED: 'false', BROWSER_SHARED_TABS: 'false', BROWSER_CDP_ENDPOINT: connection.endpoint,
        BROWSER_CDP_TARGET_ID: connection.targetId, BROWSER_SESSION_GROUP_ID: connection.sessionGroupId,
        BROWSER_CONNECTION_PROTOCOL: connection.protocol };
    },
    async afterCall(id, result) {
      if (id !== 'browser') return;
      const envelope = (result.ok ? result.data : result.error.details) as { result?: { data?: { browserTargetId?: string } } } | undefined;
      const targetId = envelope?.result?.data?.browserTargetId;
      if (targetId) await session.selectAutomationTarget(targetId);
    },
  });
  const enabledCapabilityIds = allowedCapabilityToolNames
    ? new Set([
        ...managedProviders.map(provider => provider.manifest.id),
        ...infrastructureProviders.filter((provider) => (
          (provider.manifest.skills || []).some((skill) => (
            (skill.activation || []).some((activation) => allowedCapabilityToolNames.has(activation.toolName))
          ))
        )).map((provider) => provider.manifest.id),
      ])
    : undefined;
  const capabilityRuntime = await mountAISDKCapabilities({
    responses: coreResponses,
    providers: [
      ...managedProviders,
      ...infrastructureProviders,
    ],
    context: {
      runId: referenceOptions?.runId || '',
      sessionId: referenceOptions?.sessionId,
      userId: referenceOptions?.userId,
      abortSignal: referenceOptions?.abortSignal,
    },
    configStore: runtimeCapabilityConfigStore,
    enabledCapabilityIds,
    allowedToolNames: allowedCapabilityToolNames,
    skills: {
      // Capability packages publish Skill content only. This Agent owns the
      // preload tool, per-run loaded state, and lazy instruction delivery.
      mode: 'disabled',
      includeTool: false,
      loadedSkillIds: loadedHiddenRuntimeSkillIds,
    },
    adapter: {
      decodeResponseResult: browserChatCapabilityResult,
      metadata: {
        runId: referenceOptions?.runId || '',
        stepIndex: referenceOptions?.stepIndex,
      },
      execute: ({ resolvedTool, input, context, execution }) => record(
        resolvedTool.publicName,
        input,
        async (abortSignal, trace) => capabilityResultToBrowserActionResult(await resolvedTool.tool.execute(input, {
          ...context,
          abortSignal,
          reportProgress: fileProgressReporter(trace),
        })),
        execution,
      ),
    },
  });
  const capabilityTools = capabilityRuntime.tools as ToolSet;
  const subagentAvailable = allowedCapabilityToolNames.has('subagent') && Boolean(referenceOptions?.runSubagents || referenceOptions?.readSubagentResult);
  const readableRuntimeSkills = new Set(hiddenRuntimeSkillIdsForTools(new Set([
    ...Object.keys(capabilityTools), ...(subagentAvailable ? ['subagent'] : []),
  ])));
  const mountedFileTool = capabilityTools[fileCapabilityToolNames.file];
  if (mountedFileTool) capabilityTools[fileCapabilityToolNames.file] = {
    ...mountedFileTool,
    toModelOutput: fileToolModelOutput,
  };

  const sharedTools: ToolSet = {
    ...(subagentAvailable ? {
      subagent: tool({
        description: `Delegate only independent task parts when this materially helps the active request. Ordinary questions should be answered directly. Run child Agents with action=spawn. Tasks in one batch execute concurrently, but this tool call waits for the whole batch and returns all full results directly. Use action=read with an exact uuid only to retrieve a saved or resumed child's full result. action=spawn uses hidden Skill ${subagentRuntimeSkillId}, supplied with the result if unread.`,
        inputSchema: browserToolInput({
          action: z.enum(['spawn', 'read']),
          uuid: z.string().trim().min(1).max(160).optional().describe('Exact child UUID returned by spawn; required for action=read.'),
          tasks: z.array(z.object({
            title: z.string().trim().min(1).max(160).describe('Short display title for this child Agent.'),
            instruction: z.string().trim().min(1).max(4_000).describe('Self-contained task and expected evidence for this child Agent.'),
            url: z.string().trim().url().max(4_000).optional().describe('Optional starting page URL. Omit for research, files, or code tasks without a specific page.'),
          })).min(1).optional().describe('Preferred batch form for independent child Agents. Tasks execute concurrently; spawn waits for the batch and returns full results.'),
          title: z.string().trim().min(1).max(160).optional().describe('Flat fallback title when spawning exactly one child Agent.'),
          instruction: z.string().trim().min(1).max(4_000).optional().describe('Flat fallback instruction when spawning exactly one child Agent.'),
          url: z.string().trim().url().max(4_000).optional().describe('Optional starting URL when spawning exactly one child Agent.'),
        }, [
          { reason: '并行分析独立页面', action: 'spawn', tasks: [{ title: '分析需求A', url: 'https://example.com/a', instruction: '分析页面并返回关键证据。' }] },
          { reason: '读取已有子 Agent 结果', action: 'read', uuid: 'exact-uuid-returned-by-spawn' },
        ]).superRefine((input, context) => {
          if (input.action === 'read' && !input.uuid) {
            context.addIssue({ code: z.ZodIssueCode.custom, message: 'read requires the exact uuid returned by spawn.' });
          }
          if (input.action === 'spawn' && !input.tasks?.length && !(input.title && input.instruction)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'spawn requires tasks, or the flat title and instruction fields.',
            });
          }
        }),
        execute: (input, execution) => {
          if (input.action === 'read') return record('subagent', input, abortSignal => referenceOptions?.readSubagentResult
            ? referenceOptions.readSubagentResult({ uuid: input.uuid! }, abortSignal)
            : Promise.resolve({ ok: false, actual: 'subagent action=read is unavailable in this runtime.' }), execution);
          const tasks = normalizeBrowserChatSubagentTasks(input.tasks ?? input);
          return record('subagent', input, (abortSignal, trace) => {
            if (!tasks.length) {
              return Promise.resolve({ ok: false, actual: 'subagent action=spawn requires a non-empty batch where every task has a non-blank title and instruction, and every supplied URL is a valid absolute URL. No child task was started.' });
            }
            return referenceOptions?.runSubagents ? referenceOptions.runSubagents(tasks, abortSignal, trace?.id)
              : Promise.resolve({ ok: false, actual: 'subagent action=spawn is unavailable in this runtime.' });
          }, execution);
        },
      }),
    } : {}),
    ...capabilityTools,
    finalResponse: createAISDKResponseTool(capabilityRuntime.responseSession, {
      description: runtimeBuiltinToolPrompts.finalResponse,
      onAccept: async (input, execution) => {
        const result = await record('finalResponse', input, async () => {
          const completionError = referenceOptions ? await referenceOptions.validateFinalResponse(input)
            : browserChatFinalResponseCompletionError(input);
          return completionError ? { ok: false, actual: completionError }
            : { ok: true, actual: JSON.stringify({ accepted: true, blockCount: input.blocks.length }) };
        }, execution);
        if (!result.ok) return { accepted: false, code: result.code, error: result.actual };
        return result;
      },
    }),
    skill: tool({
      description: `${runtimeBuiltinToolPrompts.skill} Current capability Skill ids: ${[...readableRuntimeSkills].join(', ') || '(none)'}.`,
      inputSchema: withToolInputExamples(z.preprocess((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
        const record = value as Record<string, unknown>;
        if (typeof record.reason === 'string' && record.reason.trim()) return value;
        const skillId = typeof record.skillId === 'string' ? record.skillId.trim() : '';
        return { ...record, reason: skillId ? `读取 Skill：${skillId}` : '读取运行规范' };
      }, z.object({
        reason: toolReasonInput,
        action: z.literal('read'),
        skillId: z.string().min(1).max(160).describe('Exact Skill id from an available <system_skill> or user Skill summary.'),
      })), [...readableRuntimeSkills].slice(0, 4).map(skillId => ({ reason: '读取运行规范', action: 'read', skillId }))),
      execute: (input, execution) => record('skill', input, async () => {
        const hiddenContent = hiddenRuntimeSkillContent(input.skillId);
        if (hiddenContent) {
          return readableRuntimeSkills.has(input.skillId)
            ? { ok: true, actual: hiddenContent } satisfies BrowserActionResult
            : { ok: false, actual: 'This capability Skill requires a tool absent from the current catalogue.' } satisfies BrowserActionResult;
        }
        return referenceOptions?.readSkill
          ? referenceOptions.readSkill(input.skillId)
          : { ok: false, actual: `Skill ${input.skillId} is unavailable in this runtime.` } satisfies BrowserActionResult;
      }, execution),
    }),
  };

  return {
    tools: Object.fromEntries(Object.entries(sharedTools).filter(([name]) => allowedCapabilityToolNames.has(name))),
    dispose: capabilityRuntime.dispose,
  };
}

function runtimePrompt(runtimeRecord: BrowserChatRuntimeRecord, input: { userId?: string; sessionId?: string; runId: string }, tools: Array<{ name: string; description: string }>) {
  const settings = getModelSettings();
  return [
    agentSystemPrompt({ userId: input.userId, sessionId: input.sessionId || input.runId, targetUrl: runtimeRecord.targetUrl,
      provider: settings.provider, model: settings.model, tools }),
    systemPromptOf(runtimeRecord),
  ].filter(Boolean).join('\n\n');
}
function binaryLogDescriptor(value: unknown, imagePath?: string) {
  const bytes = Buffer.isBuffer(value)
    ? value.length
    : ArrayBuffer.isView(value)
      ? value.byteLength
      : value instanceof ArrayBuffer
        ? value.byteLength
        : typeof value === 'string'
          ? value.length
          : undefined;
  return {
    type: 'binary',
    bytes,
    imagePath,
    attached: Boolean(imagePath),
  };
}

export function sanitizeModelLogValue(
  value: unknown,
  imagePaths: string[],
  state: { imageIndex: number },
  seen = new WeakSet<object>(),
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    const imagePath = imagePaths[state.imageIndex++];
    return binaryLogDescriptor(value, imagePath);
  }
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  try {
    if (value instanceof Error) {
      const extraEntries = Object.entries(value).filter(([key]) => !['cause', 'message', 'name', 'stack'].includes(key));
      return {
        ...Object.fromEntries(extraEntries.map(([key, item]) => [
          key,
          sanitizeModelLogValue(item, imagePaths, state, seen),
        ])),
        name: value.name,
        message: value.message,
        stack: value.stack,
        ...(value.cause === undefined ? {} : { cause: sanitizeModelLogValue(value.cause, imagePaths, state, seen) }),
      };
    }
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeModelLogValue(item, imagePaths, state, seen));
    }
    const sourceRecord = value as Record<string, unknown>;
    const sourceMediaType = typeof sourceRecord.mediaType === 'string' ? sourceRecord.mediaType : '';
    const serializedFilePart = sourceRecord.type === 'file' && typeof sourceRecord.data === 'string' && sourceRecord.data.startsWith('data:');
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(sourceRecord)) {
      if (key === 'image') {
        const imagePath = imagePaths[state.imageIndex++];
        output[key] = binaryLogDescriptor(item, imagePath);
      } else if (key === 'data' && serializedFilePart && typeof item === 'string') {
        const commaIndex = item.indexOf(',');
        const payloadCharacters = commaIndex >= 0 ? item.length - commaIndex - 1 : item.length;
        output[key] = {
          kind: 'serialized-file-data',
          mediaType: sourceMediaType || item.slice(5, item.indexOf(';') > 5 ? item.indexOf(';') : item.indexOf(',')),
          approximateBytes: Math.floor(payloadCharacters * 3 / 4),
        };
      } else {
        output[key] = sanitizeModelLogValue(item, imagePaths, state, seen);
      }
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

export type InteractiveBrowserTurnMessage = ModelMessage;

export type InteractiveBrowserTurnResult = {
  status: 'passed' | 'failed' | 'blocked';
  reply: string;
  blocks: BrowserChatFinalBlock[];
  steps: StepExecutionResult[];
  newSteps: StepExecutionResult[];
  consoleErrors: string[];
  networkErrors: string[];
  modelMessages: ModelMessage[];
  turnMessages: ModelMessage[];
  contextCompression?: BrowserChatModelContextCompression;
  continuationSummary?: string;
};

function browserChatSafetyInstructions(mode?: BrowserChatSafetyMode) {
  if (mode === 'full') {
    return [
      'Safety mode: full.',
      '- When the user request is clear, do not ask for extra confirmation only because an operation is important.',
      '- Ask for user-owned credentials, identity approval or essential information only when the active task needs them.',
    ].join('\n');
  }
  return [
    'Safety mode: strict.',
    '- The backend independently evaluates important, irreversible, externally visible, data-changing, privacy-sensitive, or costly tool calls and pauses them for user approval before execution.',
    '- Do not ask for approval in plain text and do not add approval flags to tool input. Call the intended tool normally; the backend is the authority.',
  ].join('\n');
}

function createInteractiveBrowserRuntimeRecord(input: {
  safetyMode?: BrowserChatSafetyMode;
  browserInteractionMode?: BrowserChatInteractionMode;
  targetUrl: string;
  instruction: string;
}): BrowserChatRuntimeRecord {
  const targetUrl = input.targetUrl || 'about:blank';
  const systemPrompt = browserChatSafetyInstructions(input.safetyMode);
  return {
    description: input.instruction,
    targetUrl,
    systemPrompt,
  };
}

export async function executeInteractiveBrowserTurn(input: {
  session: BrowserSession;
  runId: string;
  sessionId?: string;
  userId?: string;
  turnId?: string;
  initialStepIndex?: number;
  targetUrl: string;
  instruction: string;
  modelInstruction?: string;
  operationalContext?: string;
  conversation?: InteractiveBrowserTurnMessage[];
  continuationSummary?: string;
  completedSteps?: StepExecutionResult[];
  safetyMode?: BrowserChatSafetyMode;
  browserInteractionMode?: BrowserChatInteractionMode;
  referenceImagePaths?: string[];
  getRuntimeOperationalContext?: (toolNames?: readonly string[]) => BrowserChatOperationalContext | Promise<BrowserChatOperationalContext>;
  onProgress?: (step: StepExecutionResult) => void | Promise<void>;
  onTextStream?: (update: BrowserChatTextStreamUpdate) => void | Promise<void>;
  onReasoningStream?: (update: BrowserChatReasoningStreamUpdate) => void | Promise<void>;
  onModelMessages?: (update: {
    activeMessages: ModelMessage[];
    turnMessages: ModelMessage[];
  }) => void | Promise<void>;
  contextRecords?: Record<string, ModelMessage>;
  contextScope?: string;
  onContextCheckpoint?: (update: { records: Record<string, ModelMessage>; manifest?: RuntimeContextManifest }) => void | Promise<void>;
  onActiveModelCheckpoint?: (messages: ModelMessage[]) => void | Promise<void>;
  onContextCompression?: (update: {
    activeMessages: ModelMessage[];
    contextCompression: BrowserChatModelContextCompression;
  }) => void | Promise<void>;
  onDebug?: ExecutionDebug;
  abortSignal?: AbortSignal;
  shouldContinue?: () => boolean;
  requestToolConfirmation?: (request: BrowserToolConfirmationRequest) => Promise<BrowserToolConfirmationDecision>;
  runSubagents?: BrowserChatSubagentRunner;
  readSubagentResult?: BrowserChatSubagentReader;
  readFile?: (input: BrowserChatReadFileInput, context?: import('@cjfclonedeep/capability-sdk').CapabilityExecutionContext) => Promise<BrowserActionResult>;
  readFileVisuals?: (input: BrowserChatFileVisualInput) => Promise<BrowserActionResult>;
  readSkill?: BrowserChatReadSkill;
  attachmentBindings?: BrowserCodeAttachmentBinding[];
  credentialBindings?: BrowserCodeCredentialBinding[];
  ensureBrowserStarted?: (signal?: AbortSignal) => Promise<void>;
  allowedToolTypes?: string[];
  disabledTools?: string[];
  memoryTools?: ToolSet;
}): Promise<InteractiveBrowserTurnResult> {
  return executeAppServerBrowserTurn(input, {
    prompt: (input, tools) => runtimePrompt(createInteractiveBrowserRuntimeRecord(input), input, tools),
    tools: async (input, options) => {
      const visualContext = new VisualContextManager();
      if (options.visualContext) visualContext.restore(options.visualContext);
      return makeBrowserTools(input.session, options.traces, options.aiRequest, options.onTrace, {
        ...input, visualContext, getAiRequest: () => options.aiRequest,
        getAiRequestElapsedMs: options.getAiRequestElapsedMs,
        loadedHiddenRuntimeSkillIds: options.loadedSkills,
        archiveResult: options.archiveResult, onReferenceImage: options.onImage,
        getCredentialBindings: options.getCredentials,
        validateFinalResponse: options.validateFinalResponse,
        onVisualContextChange: () => options.onVisualContextChange(visualContext.persisted()),
      });
    },
    approve: async (name, args) => input.safetyMode === 'full' || await requestBrowserToolApproval({
      toolName: name, toolInput: args, request: input.requestToolConfirmation,
      stepIndex: (input.initialStepIndex || 0) + 1,
    }) !== 'denied',
    summarizeTraces: summarizeToolTraces,
    humanPause: subagentHumanPauseReplyFromTraces,
    validateFinalResponse: browserChatFinalResponseCompletionError,
  });
}

function errorRecordSources(error: unknown) {
  if (!error || typeof error !== 'object') return [];
  const root = error as Record<string, unknown>;
  const sources: Record<string, unknown>[] = [root];
  if (root.data && typeof root.data === 'object' && !Array.isArray(root.data)) {
    sources.push(root.data as Record<string, unknown>);
  }
  if (root.cause && typeof root.cause === 'object' && !Array.isArray(root.cause)) {
    const cause = root.cause as Record<string, unknown>;
    sources.push(cause);
    if (cause.data && typeof cause.data === 'object' && !Array.isArray(cause.data)) {
      sources.push(cause.data as Record<string, unknown>);
    }
  }
  return sources;
}

function firstErrorString(error: unknown, key: string) {
  for (const source of errorRecordSources(error)) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function firstErrorValue(error: unknown, key: string) {
  for (const source of errorRecordSources(error)) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    return value;
  }
  return undefined;
}

function firstErrorDisplay(error: unknown, key: string, max = 900) {
  return diagnosticValueText(firstErrorValue(error, key), max);
}

function firstErrorNumber(error: unknown, key: string) {
  for (const source of errorRecordSources(error)) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function errorCauseMessage(error: unknown) {
  if (!error || typeof error !== 'object') return undefined;
  const cause = (error as Record<string, unknown>).cause;
  if (cause instanceof Error) return cause.message;
  if (cause && typeof cause === 'object' && !Array.isArray(cause)) {
    const message = (cause as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  return undefined;
}

function errorDetailText(error: unknown) {
  const exitCode = firstErrorNumber(error, 'exitCode');
  const code = firstErrorString(error, 'code');
  const status = firstErrorValue(error, 'status') ?? firstErrorValue(error, 'statusCode');
  const stderr = firstErrorString(error, 'stderr');
  const responseBody = firstErrorDisplay(error, 'responseBody', 1200) || firstErrorDisplay(error, 'body', 1200);
  const promptExcerpt = firstErrorString(error, 'promptExcerpt');
  return [
    typeof exitCode === 'number' ? `exitCode=${exitCode}` : '',
    code ? `code=${code}` : '',
    status !== undefined ? `status=${diagnosticValueText(status, 120)}` : '',
    stderr ? `stderr=${trimDebugText(stderr, 1200)}` : '',
    responseBody ? `responseBody=${responseBody}` : '',
    promptExcerpt ? `promptExcerpt=${trimDebugText(promptExcerpt, 600)}` : '',
  ].filter(Boolean).join('\n');
}

function infrastructureError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown execution error');
  const details = errorDetailText(error);
  return details ? `${message}\n${details}` : message;
}

function flowInput(input: unknown) {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

export type RecordedBrowserOperationExecutionOptions = {
  browserInteractionMode?: BrowserChatInteractionMode;
  selectImages?: (ids: string[]) => unknown;
  ensureBrowserStarted?: (signal?: AbortSignal) => Promise<void>;
  runId?: string;
  abortSignal?: AbortSignal;
  attachmentBindings?: BrowserCodeAttachmentBinding[];
  credentialBindings?: BrowserCodeCredentialBinding[];
};

/**
 * Execute one previously recorded browser-chat tool against an existing browser
 * session. This is intentionally a low-level dispatcher: callers own ordering,
 * retries, repair, and final verification.
 */
export async function executeRecordedBrowserOperation(
  session: BrowserSession,
  flow: BrowserOperationRecord,
  options: RecordedBrowserOperationExecutionOptions = {},
): Promise<BrowserActionResult> {
  const input = flowInput(flow.input);
  const reason = flow.reason ? ` Recorded reason: ${flow.reason}` : '';
  const runId = options.runId;
  const abortSignal = options.abortSignal;
  const attachmentBindings = options.attachmentBindings;

  switch (flow.name) {
    case 'browser':
      return executeBrowserInteraction(session, input, {
        mode: options.browserInteractionMode, runId, stepIndex: flow.index, abortSignal,
        imageInputAvailable: modelSupportsImageInput(), ensureStarted: options.ensureBrowserStarted,
        attachments: attachmentBindings, credentials: options.credentialBindings, selectImages: options.selectImages,
      });
    case 'file':
      return executeBrowserChatFile({
        runId: runId || '',
        params: input,
        options: {
          attachmentBindings,
          currentPageUrl: () => session.currentUrl(),
          visualInputAvailable: true,
        },
        abortSignal,
        invocationId: `recorded:file:${flow.index}`,
      });
    default:
      return { ok: false, actual: `Unsupported recorded tool: ${flow.name}.${reason}` };
  }
}

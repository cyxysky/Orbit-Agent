import { z } from 'zod';
import { browserToolInput, browserRuntimeSkill } from '@cjfclonedeep/capability-sdk/browser';
import type { BrowserSession } from '@cjfclonedeep/capability-sdk/browser/node';
import { browserCodeHasImageOperation, type BrowserCodeAttachmentBinding, type BrowserCodeCredentialBinding } from '@cjfclonedeep/capability-sdk/browser/node';
import { normalizeBrowserChatInteractionMode, type BrowserChatInteractionMode } from '@/lib/browser-chat-interaction-mode';
import { browserControlShape, visualBrowserInputSchema, visualBrowserSkill } from './runtime-browser-visual';
import { executePlaywrightMcpOperation } from './runtime-browser-mcp';

const domShape = {
  ...browserControlShape,
  action: z.enum(['state', 'snapshot', 'code', 'dismissSurface', 'navigate', 'tabs', 'waitForHumanVerification', 'requestUserInput'])
    .describe('snapshot reads actionable elements and surfaces; code acts and returns data.postActionState after attempted input, data.actionOutcome="skipped" when a conditional action did not run, and data.pageErrorIndicators for visible HTTP errors (page.verifyState does not exist); dismissSurface always sends a direct mouse click at viewport (0,0), then reports data.closureConfirmed and postActionState. A delivered click is not proof that the popup closed.'),
  reason: z.string().min(1).max(300),
  question: z.string().min(1).max(4000).optional().describe('requestUserInput: ask for specific user-owned information or an attachment needed for the current task; the user reply resumes the same task.'),
  code: z.string().min(1).max(40000).optional(),
  scope: z.enum(['active', 'all']).optional(), frame: z.string().max(200).optional(),
  selector: z.string().max(2000).optional(), query: z.string().max(300).optional(), cursor: z.string().max(1000).optional(),
  maxOutputChars: z.number().int().min(1000).max(200000).optional(),
  maxMs: z.number().int().min(1000).max(1800000).optional(),
  snapshotView: z.enum(['actionable', 'full', 'text']).optional().describe('snapshot only: actionable controls by default, full semantic tree, or readable text.'),
  snapshotCursor: z.string().min(1).max(1000).optional().describe('snapshot only: nextCursor from the same DOM observation.'),
  recoveryReview: z.string().max(6000).optional(),
  observationMode: z.enum(['replace', 'append', 'keep-pair']).optional(),
};
const domSchema = z.object(domShape).strict().superRefine((value, ctx) => {
  if (value.action === 'code' && !value.code) ctx.addIssue({ code: 'custom', path: ['code'], message: 'code is required' });
  if (value.action === 'navigate' || value.action === 'tabs') {
    const result = visualBrowserInputSchema.safeParse(value);
    if (!result.success) for (const issue of result.error.issues) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  }
});
const hybridSchema = z.object({ ...visualBrowserInputSchema.shape, ...domShape,
  action: z.enum(['state', 'snapshot', 'code', 'dismissSurface', 'observe', 'act', 'images', 'navigate', 'tabs', 'waitForHumanVerification', 'requestUserInput'])
    .describe('snapshot reads actionable elements and surfaces; code acts and returns data.postActionState after attempted input, data.actionOutcome="skipped" when a conditional action did not run, and data.pageErrorIndicators for visible HTTP errors (page.verifyState does not exist); dismissSurface always sends a direct mouse click at viewport (0,0), then reports data.closureConfirmed and postActionState. A delivered click is not proof that the popup closed.'),
}).strict().superRefine((value, ctx) => {
  try { parseBrowserInteractionInput(value, 'hybrid'); }
  catch (error) { ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Invalid browser action' }); }
});
const mcpSchema = z.object({
  ...browserControlShape,
  action: z.enum(['mcp', 'navigate', 'tabs', 'waitForHumanVerification', 'requestUserInput']),
  reason: z.string().min(1).max(300),
  question: z.string().min(1).max(4000).optional(),
  tool: z.string().min(1).max(100).optional().describe('Use list to discover tools, then an exact official Playwright MCP browser_* tool name.'),
  arguments: z.record(z.string(), z.unknown()).optional(),
  maxMs: z.number().int().min(1000).max(1800000).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.action === 'requestUserInput' && !value.question) ctx.addIssue({ code: 'custom', path: ['question'], message: 'requestUserInput requires question' });
  if (value.action === 'mcp' && !value.tool) ctx.addIssue({ code: 'custom', path: ['tool'], message: 'mcp requires tool' });
  if (value.action === 'navigate' || value.action === 'tabs') {
    const result = visualBrowserInputSchema.safeParse(value);
    if (!result.success) for (const issue of result.error.issues) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  }
});

function visiblePageErrorIndicators(state: unknown) {
  const result = state && typeof state === 'object' ? state as { data?: unknown } : undefined;
  const data = result?.data && typeof result.data === 'object' ? result.data as { pageState?: unknown } : undefined;
  if (typeof data?.pageState !== 'string') return [];
  return data.pageState.split(/\r?\n/)
    .filter((line) => /\[(?:4|5)\d\d\]|\b(?:HTTP|status)\s*:?\s*[45]\d\d\b/i.test(line))
    .slice(0, 3)
    .map((line) => line.trim().slice(0, 400));
}

export function browserInteractionSchema(mode: BrowserChatInteractionMode) {
  return mode === 'mcp' ? mcpSchema : mode === 'visual' ? visualBrowserInputSchema : mode === 'dom' ? domSchema : hybridSchema;
}
export function parseBrowserInteractionInput(value: unknown, mode: BrowserChatInteractionMode) {
  const action = value && typeof value === 'object' ? (value as { action?: string }).action : undefined;
  if (mode === 'mcp') return mcpSchema.parse(value);
  if (mode !== 'visual' && (action === 'snapshot' || action === 'dismissSurface')) return domSchema.parse(value);
  if (mode !== 'visual' && (action === 'state' || action === 'code')) {
    return browserToolInput.parse(domSchema.parse(value));
  }
  if (mode === 'dom' && !['navigate', 'tabs', 'waitForHumanVerification', 'requestUserInput'].includes(action || '')) throw new Error('DOM mode allows state, snapshot, code, dismissSurface, navigate, tabs, waitForHumanVerification and requestUserInput.');
  return visualBrowserInputSchema.parse(value);
}
export function browserInteractionInstructions(mode: BrowserChatInteractionMode) {
  if (mode === 'mcp') return 'Browser interaction mode: PLAYWRIGHT MCP. The browser tool accepts action=mcp, tool=list to discover the official server tools and their schemas, then action=mcp with an exact browser_* tool name and its arguments. Use browser_snapshot to inspect live accessibility state and browser_click/browser_type/browser_fill_form for interaction. Use native action=navigate and action=tabs for URLs and session-owned tabs; MCP tab management is unavailable to the model. The official MCP server attaches to this conversation browser through its automation endpoint; do not use historical tab indexes or element references. browser_run_code_unsafe is unavailable. After each call, read the returned snapshot and the latest screenshot pixels in [Current browser observation] when image input is available. A successful MCP receipt is not proof of the requested page or business outcome. If a target is covered by a picker, use the picker itself or an evidenced dismissal action before clicking behind it. Use action=waitForHumanVerification for secret entry that requires the user. Use action=requestUserInput with a concrete question only when user-owned information or an attachment is essential and cannot be obtained from available evidence; the reply resumes the same task.';
  return 'Use navigate for URL/route navigation and tabs for listing, opening, selecting or closing session tabs. These browser controls are available in every mode. Page keyboard actions cannot control the address bar or browser tabs. Use requestUserInput with a concrete question only when user-owned information or an attachment is essential and independent work is complete. The user may reply in the conversation and the same task resumes; do not report the task complete while waiting. For code calls, data.actionOutcome="skipped" means reads succeeded but a conditional browser action did not run; inspect data.recoveryState and do not claim the action completed. ' + (mode === 'visual'
    ? 'Browser interaction mode: VISUAL. Use observe/act/images with current screenshot evidence. DOM, AX, locators and page scripts are unavailable. Never bypass this mode through other tools or recalled historical instructions.'
    : mode === 'dom'
      ? 'Browser interaction mode: DOM. Use snapshot for actionable semantic controls and the current surface, state for scoped Playwright AX tree, and code for Playwright actions. page.verifyState does not exist. After attempted code input, inspect data.postActionState and the returned result before dependent work; use ordinary Playwright reads inside a cell if a dependent action needs immediate evidence. When image input and automatic capture are available, the next request also includes the latest viewport pixels in [Current browser observation]; inspect them without a separate image-read call. If unavailable, use live DOM without claiming visual inspection. dismissSurface always sends a direct mouse click at viewport (0,0), without Escape or a surface-id prerequisite. Outer ok means the click was delivered, not that the popup closed; inspect data.closureConfirmed, data.outcome, data.postActionState, and the latest screenshot before continuing.'
      : 'Browser interaction mode: HYBRID. Use snapshot for actionable semantic controls and the current surface, state for scoped Playwright AX tree, code for Playwright actions, and observe/act/images for visual interaction. page.verifyState does not exist. After attempted code input, inspect data.postActionState and the returned result before dependent work; use ordinary Playwright reads inside a cell if a dependent action needs immediate evidence. When image input and automatic capture are available, the next request also includes the latest viewport pixels in [Current browser observation]; inspect them without a separate image-read call. If unavailable, use live DOM without claiming visual inspection. dismissSurface always sends a direct mouse click at viewport (0,0), without Escape or a surface-id prerequisite. Outer ok means the click was delivered, not that the popup closed; inspect data.closureConfirmed, data.outcome, data.postActionState, and the latest screenshot before continuing.');
}

// One installed Skill describes the protocol; the host-selected mode and schema
// narrow it on every request, including when the user changes modes mid-session.
export const browserInteractionSkill = {
  ...browserRuntimeSkill,
  id: 'system-browser-interaction-runtime',
  summary: '<system_skill><id>system-browser-interaction-runtime</id><title>Browser</title><description>DOM, visual, hybrid or Playwright MCP browser interaction according to the host-selected mode.</description></system_skill>',
  content: `The host-selected browser interaction mode overrides mode-specific guidance below. Only use actions in the current tool schema. Historical mode settings do not authorize unavailable actions. In Playwright MCP mode, use the official MCP tool definitions returned by browser action=mcp tool=list, and use native navigate/tabs for session-owned navigation. MCP tool results and the current screenshot are evidence, not business success. Use requestUserInput with a concrete question only when essential information or a file must come from the user; their reply resumes the same task.\n\nDOM and hybrid code protocol:\n${browserRuntimeSkill.content.replaceAll(browserRuntimeSkill.id, 'system-browser-interaction-runtime')}\n\nVisual protocol (visual mode; also available in hybrid):\n${visualBrowserSkill.content}\n\nIn hybrid mode the visual protocol restrictions on DOM/AX/code apply only to the act action; state and code remain available. In DOM mode use DOM/locators for actions, and inspect the attached latest screenshot as outcome evidence when image input is supported. Receiving an image does not require a separate read tool call; do not ignore its visible state when planning the next dependent action.`,
  activation: [{ toolName: 'browser', actions: ['state', 'snapshot', 'code', 'dismissSurface', 'observe', 'act', 'images', 'navigate', 'tabs', 'waitForHumanVerification', 'requestUserInput', 'mcp'] }],
};

export async function executeBrowserInteraction(session: BrowserSession, raw: unknown, options: {
  mode?: BrowserChatInteractionMode; runId?: string; stepIndex?: number; imageInputAvailable?: boolean;
  abortSignal?: AbortSignal; ensureStarted?: (signal?: AbortSignal) => Promise<void>;
  attachments?: BrowserCodeAttachmentBinding[]; credentials?: BrowserCodeCredentialBinding[];
  selectImages?: (ids: string[]) => unknown;
}) {
  const mode = normalizeBrowserChatInteractionMode(options.mode);
  const command = parseBrowserInteractionInput(raw, mode);
  const signal = options.abortSignal;
  if (command.action === 'requestUserInput') return { ok: true,
    actual: '已暂停当前任务，等待用户通过对话输入文字或附件。收到回复后继续同一任务。',
    userInput: { requested: true, question: command.question } };
  await options.ensureStarted?.(signal);
  if (command.action === 'mcp') return executePlaywrightMcpOperation(session, { tool: command.tool!, arguments: command.arguments }, {
    runId: options.runId || 'browser', abortSignal: signal,
  });
  if (command.action === 'navigate' || command.action === 'tabs') {
    return session.executeBrowserControl({ action: command.action, url: command.url,
      tabOperation: command.tabOperation, tabId: command.tabId, abortSignal: signal });
  }
  if (command.action === 'waitForHumanVerification') return session.waitForManualVerification(command.maxMs, signal);
  if (command.action === 'snapshot') {
    try {
      const snapshot = await session.readDomObservationSnapshot({ mode: command.snapshotView || 'actionable',
        cursor: command.snapshotCursor, maxOutputChars: command.maxOutputChars || 12000 });
      const activeAx = await session.readBrowserState({ scope: 'active', maxOutputChars: 8000, abortSignal: signal });
      const activeAxData = activeAx.data && typeof activeAx.data === 'object'
        ? activeAx.data as { pageState?: string; truncated?: boolean; nextCursor?: string } : undefined;
      return { ok: true, data: { ...snapshot,
        playwrightAx: activeAxData?.pageState || (activeAx.ok ? '' : activeAx.actual || '[Playwright AX snapshot unavailable]'),
        playwrightAxTruncated: activeAxData?.truncated === true,
        ...(activeAxData?.nextCursor ? { playwrightAxCursor: activeAxData.nextCursor } : {}) },
        summary: `Read ${snapshot.returnedEntries} ${snapshot.mode} browser snapshot entries and the active Playwright AX tree; use current DOM UIDs or roles/names for locators and nextCursor when hasMore is true.` };
    } catch (error) {
      return { ok: false, failureCategory: 'browser-snapshot-stale',
        actual: error instanceof Error ? error.message : String(error) };
    }
  }
  if (command.action === 'dismissSurface') {
    const result = await session.dismissBrowserSurface({ abortSignal: signal });
    const postActionState = await session.readBrowserState({ scope: 'active', maxOutputChars: 4000, abortSignal: signal })
      .catch((error) => ({ ok: false, actual: error instanceof Error ? error.message : String(error) }));
    const observation = options.imageInputAvailable === false ? undefined
      : await session.captureBrowserObservation(options.runId || 'browser', signal).catch(() => undefined);
    return { ...result,
      data: { ...(result.data as object), postActionState },
      ...(observation ? { browserObservation: observation, referenceImagePath: observation.path } : {}) };
  }
  if (command.action === 'state') return session.readBrowserState({ ...command, abortSignal: signal });
  if (command.action === 'code') {
    const code = command.code;
    if (!code) throw new Error('code is required for browser action=code.');
    const imageInputAvailable = options.imageInputAvailable !== false;
    if (!imageInputAvailable && browserCodeHasImageOperation(code)) return { ok: false, actual: 'Browser images are unavailable in this mode/model. Use current DOM and locators.' };
    const result = await session.executeBrowserCode({ ...command, code, imageInputAvailable, ensureStarted: options.ensureStarted,
      attachments: options.attachments, credentials: options.credentials, runId: options.runId || 'browser',
      stepIndex: options.stepIndex || 0, abortSignal: signal });
    const data = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
    const skippedAction = data.actionOutcome === 'skipped';
    const executionState = data.executionState && typeof data.executionState === 'object'
      ? data.executionState as { attemptedActions?: unknown } : undefined;
    const attemptedAction = Array.isArray(executionState?.attemptedActions) && executionState.attemptedActions.length > 0;
    if (!skippedAction && !attemptedAction && result.ok) return result;
    // Preserve the execution result and attach one bounded live observation
    // after attempted input or a failed cell whose input outcome is uncertain.
    const recovery = skippedAction || !attemptedAction;
    const currentState = await session.readBrowserState({ scope: 'active', maxOutputChars: recovery ? 8000 : 4000, abortSignal: signal })
      .catch((error) => ({ ok: false, actual: error instanceof Error ? error.message : String(error) }));
    const pageErrorIndicators = visiblePageErrorIndicators(currentState);
    return {
      ...result,
      data: { ...data, [recovery ? 'recoveryState' : 'postActionState']: currentState,
        ...(pageErrorIndicators.length ? { pageErrorIndicators } : {}) },
      ...(pageErrorIndicators.length ? {
        summary: `${result.summary || 'Browser script returned.'} Visible page error indicator: ${pageErrorIndicators[0]}. Investigate before attributing an empty or unexpected view to business logic.`,
      } : {}),
    };
  }
  if (options.imageInputAvailable === false) return { ok: false, actual: 'Visual actions require a model with image input. Use DOM actions in hybrid mode or select an image-capable model.' };
  if (command.action === 'images') return options.selectImages
    ? { ok: true, actual: JSON.stringify(options.selectImages(command.imageIds || [])) }
    : { ok: false, actual: 'Image selection is unavailable outside the owning Agent runtime.' };
  if (command.action === 'observe') {
    const observation = await session.captureBrowserObservation(options.runId || 'browser', signal);
    return { ok: observation.status === 'available', actual: 'Current viewport observation.', browserObservation: observation, referenceImagePath: observation.path };
  }
  if (!('kind' in command) || !('observationId' in command)) return { ok: false, actual: 'The selected browser mode does not support a visual action.' };
  return session.executeVisualBrowserAction({ ...command, kind: command.kind!, observationId: command.observationId!, runId: options.runId || 'browser', abortSignal: signal });
}

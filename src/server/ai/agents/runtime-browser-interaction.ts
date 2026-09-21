import { z } from 'zod';
import { browserToolInput, browserRuntimeSkill } from '@cjfclonedeep/capability-sdk/browser';
import type { BrowserSession } from '@cjfclonedeep/capability-sdk/browser/node';
import { browserCodeHasImageOperation, type BrowserCodeAttachmentBinding, type BrowserCodeCredentialBinding } from '@cjfclonedeep/capability-sdk/browser/node';
import { normalizeBrowserChatInteractionMode, type BrowserChatInteractionMode } from '@/lib/browser-chat-interaction-mode';
import { browserControlShape, visualBrowserInputSchema, visualBrowserSkill } from './runtime-browser-visual';

const domShape = {
  ...browserControlShape,
  action: z.enum(['state', 'code', 'navigate', 'tabs', 'waitForHumanVerification']),
  reason: z.string().min(1).max(300),
  code: z.string().min(1).max(40000).optional(),
  scope: z.enum(['active', 'all']).optional(), frame: z.string().max(200).optional(),
  selector: z.string().max(2000).optional(), query: z.string().max(300).optional(), cursor: z.string().max(1000).optional(),
  maxOutputChars: z.number().int().min(1000).max(200000).optional(),
  maxMs: z.number().int().min(1000).max(1800000).optional(),
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
  action: z.enum(['state', 'code', 'observe', 'act', 'images', 'navigate', 'tabs', 'waitForHumanVerification']),
}).strict().superRefine((value, ctx) => {
  try { parseBrowserInteractionInput(value, 'hybrid'); }
  catch (error) { ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Invalid browser action' }); }
});

export function browserInteractionSchema(mode: BrowserChatInteractionMode) {
  return mode === 'visual' ? visualBrowserInputSchema : mode === 'dom' ? domSchema : hybridSchema;
}
export function parseBrowserInteractionInput(value: unknown, mode: BrowserChatInteractionMode) {
  const action = value && typeof value === 'object' ? (value as { action?: string }).action : undefined;
  if (mode !== 'visual' && (action === 'state' || action === 'code')) {
    return browserToolInput.parse(domSchema.parse(value));
  }
  if (mode === 'dom' && !['navigate', 'tabs', 'waitForHumanVerification'].includes(action || '')) throw new Error('DOM mode allows state, code, navigate, tabs and waitForHumanVerification.');
  return visualBrowserInputSchema.parse(value);
}
export function browserInteractionInstructions(mode: BrowserChatInteractionMode) {
  return 'Use navigate for URL/route navigation and tabs for listing, opening, selecting or closing session tabs. These browser controls are available in every mode. Page keyboard actions cannot control the address bar or browser tabs. ' + (mode === 'visual'
    ? 'Browser interaction mode: VISUAL. Use observe/act/images with current screenshot evidence. DOM, AX, locators and page scripts are unavailable. Never bypass this mode through other tools or recalled historical instructions.'
    : mode === 'dom'
      ? 'Browser interaction mode: DOM. Use state for live DOM and code for Playwright/locator actions. Browser screenshots and visual act/images/observe are unavailable. Never use old screenshots or other tools to bypass DOM mode. Verify with current DOM evidence.'
      : 'Browser interaction mode: HYBRID. Use state/code for exact live DOM inspection and Playwright actions; use observe/act/images for screenshot-based interaction when useful. Both DOM and visual evidence are available. Choose based on the task, verify the result, and do not guess hidden attributes or coordinates.');
}

// One installed Skill describes the protocol; the host-selected mode and schema
// narrow it on every request, including when the user changes modes mid-session.
export const browserInteractionSkill = {
  ...browserRuntimeSkill,
  id: 'system-browser-interaction-runtime',
  summary: '<system_skill><id>system-browser-interaction-runtime</id><title>Browser</title><description>DOM, visual or hybrid browser interaction according to the host-selected mode.</description></system_skill>',
  content: `The host-selected browser interaction mode overrides mode-specific guidance below. Only use actions in the current tool schema. Historical mode settings do not authorize unavailable actions.\n\nDOM and hybrid code protocol:\n${browserRuntimeSkill.content.replaceAll(browserRuntimeSkill.id, 'system-browser-interaction-runtime')}\n\nVisual protocol (visual mode; also available in hybrid):\n${visualBrowserSkill.content}\n\nIn hybrid mode the visual protocol restrictions on DOM/AX/code apply only to the act action; state and code remain available. In DOM mode ignore screenshot guidance and never request or use browser images.`,
  activation: [{ toolName: 'browser', actions: ['state', 'code', 'observe', 'act', 'images', 'navigate', 'tabs', 'waitForHumanVerification'] }],
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
  await options.ensureStarted?.(signal);
  if (command.action === 'navigate' || command.action === 'tabs') {
    return session.executeBrowserControl({ action: command.action, url: command.url,
      tabOperation: command.tabOperation, tabId: command.tabId, abortSignal: signal });
  }
  if (command.action === 'waitForHumanVerification') return session.waitForManualVerification(command.maxMs, signal);
  if (command.action === 'state') return session.readBrowserState({ ...command, abortSignal: signal });
  if (command.action === 'code') {
    const imageInputAvailable = mode !== 'dom' && options.imageInputAvailable !== false;
    if (!imageInputAvailable && browserCodeHasImageOperation(command.code)) return { ok: false, actual: 'Browser images are unavailable in this mode/model. Use current DOM and locators.' };
    return session.executeBrowserCode({ ...command, imageInputAvailable, ensureStarted: options.ensureStarted,
      attachments: options.attachments, credentials: options.credentials, runId: options.runId || 'browser',
      stepIndex: options.stepIndex || 0, abortSignal: signal });
  }
  if (options.imageInputAvailable === false) return { ok: false, actual: 'Visual actions require a model with image input. Use DOM actions in hybrid mode or select an image-capable model.' };
  if (command.action === 'images') return options.selectImages
    ? { ok: true, actual: JSON.stringify(options.selectImages(command.imageIds || [])) }
    : { ok: false, actual: 'Image selection is unavailable outside the owning Agent runtime.' };
  if (command.action === 'observe') {
    const observation = await session.captureBrowserObservation(options.runId || 'browser', signal);
    return { ok: observation.status === 'available', actual: 'Current viewport observation.', browserObservation: observation, referenceImagePath: observation.path };
  }
  return session.executeVisualBrowserAction({ ...command, kind: command.kind!, observationId: command.observationId!, runId: options.runId || 'browser', abortSignal: signal });
}

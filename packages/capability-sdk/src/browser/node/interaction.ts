import type { BrowserSession, BrowserActionResult } from './browser-session.ts';
import type { BrowserCodeAttachmentBinding, BrowserCodeCredentialBinding } from './browser-code-runner.ts';
import { browserCodeHasImageOperation } from './browser-code-runner.ts';
import { z } from 'zod';
import { visualBrowserInputSchema } from '../interaction-schema.ts';
export const browserSessionCommandShape = {
  ...visualBrowserInputSchema.shape,
  reason: z.string().min(1).max(300).optional(),
  action: z.enum(['code','state','snapshot','dismissSurface','navigate','tabs','observe','act','images','waitForHumanVerification']),
  code: z.string().min(1).max(40000).optional(),
  scope: z.enum(['active','all']).optional(), frame: z.string().min(1).max(200).optional(),
  selector: z.string().min(1).max(2000).optional(), query: z.string().min(1).max(300).optional(),
  cursor: z.string().min(1).max(1000).optional(), maxOutputChars: z.number().int().min(1000).max(200000).optional(),
  snapshotView: z.enum(['actionable','full','text']).optional(), snapshotCursor: z.string().optional(),
};
const commandSchema = z.object(browserSessionCommandShape);
export type BrowserSessionCommand = z.infer<typeof commandSchema>;
export async function executeBrowserSessionOperation(session: BrowserSession, command: BrowserSessionCommand, options: {
  mode?: 'dom' | 'hybrid' | 'visual' | 'mcp'; runId?: string; stepIndex?: number; imageInputAvailable?: boolean;
  abortSignal?: AbortSignal; ensureStarted?: (signal?: AbortSignal) => Promise<void>;
  attachments?: BrowserCodeAttachmentBinding[]; credentials?: BrowserCodeCredentialBinding[];
  selectImages?: (ids: string[]) => unknown;
} = {}): Promise<BrowserActionResult> {
  const mode = options.mode || 'hybrid';
  const signal = options.abortSignal;
  if (command.action === 'navigate' || command.action === 'tabs') {
    const result = await session.executeBrowserControl({ action: command.action, url: command.url,
      tabOperation: command.tabOperation, tabId: command.tabId, abortSignal: signal });
    if (mode === 'visual' || command.action === 'tabs' && (!command.tabOperation || command.tabOperation === 'list')) return result;
    const postActionState = await session.readBrowserState({ scope: 'active', maxOutputChars: 4000, abortSignal: signal })
      .catch((error) => ({ ok: false, actual: error instanceof Error ? error.message : String(error) }));
    return { ...result, data: { ...(result.data as object | undefined), postActionState } };
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
    const observation = options.imageInputAvailable === false ? undefined
      : await session.captureBrowserObservation(options.runId || 'browser', signal).catch(() => undefined);
    if (mode === 'visual') {
      const resultData = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
      return { ...result,
        data: { method: resultData.method, point: resultData.point, outcome: resultData.outcome,
          closureConfirmed: resultData.closureConfirmed, urlChanged: resultData.urlChanged,
          ...(typeof resultData.error === 'string' ? { error: resultData.error } : {}) },
        ...(observation ? { browserObservation: observation, referenceImagePath: observation.path } : {}) };
    }
    const postActionState = await session.readBrowserState({ scope: 'active', maxOutputChars: 4000, abortSignal: signal })
      .catch((error) => ({ ok: false, actual: error instanceof Error ? error.message : String(error) }));
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

function visiblePageErrorIndicators(state: unknown) {
  const result = state && typeof state === 'object' ? state as { data?: unknown } : undefined;
  const data = result?.data && typeof result.data === 'object' ? result.data as { pageState?: unknown } : undefined;
  if (typeof data?.pageState !== 'string') return [];
  return data.pageState.split(/\r?\n/)
    .filter((line) => /\[(?:4|5)\d\d\]|\b(?:HTTP|status)\s*:?\s*[45]\d\d\b/i.test(line))
    .slice(0, 3)
    .map((line) => line.trim().slice(0, 400));
}

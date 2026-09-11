import { browserCapabilityToolNames } from '@webpilot/capability-browser';

export const browserStatePrerequisiteToolName = 'browser.state';

export const runtimeToolLoopStopToolNames = [
  'finalResponse',
  'subagent',
] as const;

export const runtimeBrowserSessionToolNames: ReadonlySet<string> = new Set([
  browserCapabilityToolNames.browser,
]);

export function runtimeToolRequiresBrowserSession(toolName: string) {
  return runtimeBrowserSessionToolNames.has(toolName);
}

export function runtimeAllowedToolTypes({
  browserChatMode,
  codexMode,
  nativeToolNames,
  observationToolNames,
}: {
  browserChatMode: boolean;
  codexMode: boolean;
  nativeToolNames: string[];
  observationToolNames: ReadonlySet<string>;
}) {
  const nativeAllowedToolTypes = nativeToolNames;
  void observationToolNames;
  return browserChatMode && codexMode ? [...nativeAllowedToolTypes, 'answer'] : nativeAllowedToolTypes;
}

function actionFromInput(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const action = (input as Record<string, unknown>).action;
  return typeof action === 'string' ? action : undefined;
}

/** An interrupted action is not a successful task, even if its click completed. */
export function browserExecutionRecoveryRequired(
  traces: Array<{ name?: string; input?: unknown; result?: unknown }>,
) {
  let pending = false;
  const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
  for (const trace of traces) {
    const result = record(trace.result);
    if (!result) continue;
    const prerequisites = Array.isArray(result.prerequisiteResults) ? result.prerequisiteResults : [];
    if (prerequisites.some(entry => record(entry)?.toolName === browserStatePrerequisiteToolName
      && record(record(entry)?.result)?.ok === true)) pending = false;
    if (trace.name !== browserCapabilityToolNames.browser) continue;
    if (actionFromInput(trace.input) === 'state' && result.ok === true) pending = false;
    const state = record(record(result.data)?.executionState);
    if (result.ok === false && state?.requiresStateRefresh === true && state.outcome === 'unknown') pending = true;
  }
  return pending;
}

export function requiresBrowserStatePreflight(
  alreadyCompleted: boolean,
  traces: Array<{ name?: string; input?: unknown; result?: unknown }>,
) {
  if (browserExecutionRecoveryRequired(traces)) return true;
  return !alreadyCompleted
    && !traces.some((trace) => {
      if (
        trace.name === browserCapabilityToolNames.browser
        && actionFromInput(trace.input) === 'state'
        && trace.result !== undefined
      ) return true;
      if (!trace.result || typeof trace.result !== 'object' || !('prerequisiteResults' in trace.result)) return false;
      const prerequisiteResults = trace.result.prerequisiteResults;
      return Array.isArray(prerequisiteResults) && prerequisiteResults.some((entry) => (
        entry
        && typeof entry === 'object'
        && 'toolName' in entry
        && entry.toolName === browserStatePrerequisiteToolName
        && 'result' in entry
        && entry.result !== undefined
      ));
    });
}

export function browserToolPrerequisiteNames(
  toolName: string,
  toolInput: unknown,
  preflightPending: boolean,
  browserToolNames: ReadonlySet<string>,
) {
  return preflightPending
    && toolName === browserCapabilityToolNames.browser
    && actionFromInput(toolInput) !== 'state'
    && browserToolNames.has(toolName)
    ? [browserStatePrerequisiteToolName] as const
    : [] as const;
}

export function isBrowserHumanVerificationCall(toolName: string, toolInput: unknown) {
  return toolName === browserCapabilityToolNames.browser
    && actionFromInput(toolInput) === 'waitForHumanVerification';
}

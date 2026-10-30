import { browserCapabilityToolNames } from '@cjfclonedeep/capability-sdk/browser';

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

export function isBrowserHumanPauseCall(toolName: string, toolInput: unknown) {
  return toolName === browserCapabilityToolNames.browser
    && ['waitForHumanVerification', 'requestUserInput'].includes(actionFromInput(toolInput) || '');
}

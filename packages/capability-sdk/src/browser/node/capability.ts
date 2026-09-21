import type { CapabilityConfiguration, CapabilityExecutionContext, CapabilityHealth } from '../../index.ts';
import {
  browserOperationToCapabilityResult,
  createBrowserCapability,
  type BrowserCapabilityOperations,
  type BrowserCodeInput,
  type ReadBrowserStateInput,
  type WaitForHumanVerificationInput,
} from '../index.ts';
import {
  browserCodeHasImageOperation,
  type BrowserCodeAttachmentBinding,
  type BrowserCodeCredentialBinding,
} from './browser-code-runner.ts';
import { BrowserSession } from './browser-session.ts';

export const readBrowserStateCode = 'nodeRepl.write({ tabs: await browser.user.openTabs(), activePage: { url: page.url(), title: await page.title() }, pageState: await page.domSnapshot() })';

export type NodeBrowserOperationsOptions = {
  session: BrowserSession;
  runId: string;
  stepIndex?: number;
  attachments?: BrowserCodeAttachmentBinding[];
  credentials?: BrowserCodeCredentialBinding[] | (() => BrowserCodeCredentialBinding[] | undefined);
  imageInputAvailable?: boolean;
  validateCode?: (code: string) => string | undefined;
  ensureStarted?: (signal?: AbortSignal) => Promise<void>;
  disposeSession?: boolean;
  configuration?: CapabilityConfiguration;
};

export function createNodeBrowserOperations(
  options: NodeBrowserOperationsOptions,
): BrowserCapabilityOperations {
  options.session.configure(options.configuration);
  const ensureStarted = options.ensureStarted || (() => options.session.ensureStarted());
  const credentials = () => typeof options.credentials === 'function'
    ? options.credentials()
    : options.credentials;
  const execute = async (
    input: Pick<BrowserCodeInput, 'code' | 'maxOutputChars' | 'observationMode'>,
    context: CapabilityExecutionContext,
  ) => {
    const violation = options.validateCode?.(input.code);
    if (violation) return browserOperationToCapabilityResult({ ok: false, actual: violation });
    if (options.imageInputAvailable === false && browserCodeHasImageOperation(input.code)) {
      return browserOperationToCapabilityResult({
        ok: false,
        actual: 'Image operation rejected because this host does not provide model image input. Use exact Locator and boundingBox evidence instead.',
      });
    }
    return browserOperationToCapabilityResult(await options.session.executeBrowserCode({
      ensureStarted,
      imageInputAvailable: options.imageInputAvailable,
      code: input.code,
      observationMode: input.observationMode,
      maxOutputChars: input.maxOutputChars,
      attachments: options.attachments,
      credentials: credentials(),
      runId: options.runId,
      stepIndex: options.stepIndex || 0,
      abortSignal: context.abortSignal,
    }));
  };
  return {
    async readBrowserState(input: ReadBrowserStateInput, context) {
      await ensureStarted(context.abortSignal);
      context.abortSignal?.throwIfAborted();
      return browserOperationToCapabilityResult(await options.session.readBrowserState({
        ...input,
        abortSignal: context.abortSignal,
        maxOutputChars: input.maxOutputChars ?? 40_000,
      }));
    },
    browserCode: (input: BrowserCodeInput, context) => execute(input, context),
    async waitForHumanVerification(input: WaitForHumanVerificationInput, context) {
      await ensureStarted(context.abortSignal);
      context.abortSignal?.throwIfAborted();
      return browserOperationToCapabilityResult(
        await options.session.waitForManualVerification(input.maxMs, context.abortSignal),
      );
    },
    health: async (): Promise<CapabilityHealth> => ({
      status: options.session.isUsable() ? 'healthy' : 'degraded',
      message: options.session.isUsable() ? undefined : 'Browser session is not started.',
    }),
    dispose: options.disposeSession ? () => options.session.close() : async () => undefined,
  };
}

export function createNodeBrowserCapability(options: {
  createOptions(context: import('../../index.ts').CapabilityRunContext):
    NodeBrowserOperationsOptions | Promise<NodeBrowserOperationsOptions>;
}) {
  return createBrowserCapability({
    createOperations: async (context) => {
      const resolved = await options.createOptions(context);
      return createNodeBrowserOperations({
        ...resolved,
        configuration: {
          ...context.configuration,
          ...resolved.configuration,
        },
      });
    },
  });
}

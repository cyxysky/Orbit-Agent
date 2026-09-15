import { createBrowserCapability } from '@cjfclonedeep/capability-sdk/browser';
import {
  createNodeBrowserOperations,
  type BrowserCodeAttachmentBinding,
  type BrowserCodeCredentialBinding,
  type BrowserSession,
} from '@cjfclonedeep/capability-sdk/browser/node';
import { browserCodeServiceFileDeliveryViolation } from '@/server/ai/agents/browser-chat-file-delivery';

export type BrowserChatBrowserCapabilityOptions = {
  session: BrowserSession;
  runId: string;
  stepIndex?: number;
  attachmentBindings?: BrowserCodeAttachmentBinding[];
  credentialBindings?: BrowserCodeCredentialBinding[];
  getCredentialBindings?: () => BrowserCodeCredentialBinding[] | undefined;
  imageInputAvailable: boolean;
  ensureStarted?: (signal?: AbortSignal) => Promise<void>;
};

export function createBrowserChatBrowserCapability(
  options: BrowserChatBrowserCapabilityOptions,
) {
  return createBrowserCapability({
    createOperations: (context) => createNodeBrowserOperations({
      session: options.session,
      ensureStarted: options.ensureStarted,
      runId: options.runId,
      stepIndex: options.stepIndex,
      attachments: options.attachmentBindings,
      credentials: options.getCredentialBindings || options.credentialBindings,
      imageInputAvailable: options.imageInputAvailable,
      validateCode: browserCodeServiceFileDeliveryViolation,
      configuration: context.configuration,
    }),
  });
}

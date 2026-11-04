import { createBrowserPreviewServer } from '@cjfclonedeep/capability-sdk/browser/preview/server';
import { consumeWebSocketTicket } from '@/server/auth/websocket-ticket';
import { dispatchBrowserChatPreviewInput, startBrowserChatScreencast } from '@/server/ai/agents/browser-chat.service';
import { browserRuntimeConfiguration } from '@/server/capabilities/webpilot-browser';
import { browserPreviewPreferredTransport as preferredTransport } from '@cjfclonedeep/capability-sdk/browser/preview/server';
import { runtimeSetting } from '@/server/settings/runtime-configuration';

export function browserPreviewPreferredTransport() {
  return preferredTransport(runtimeSetting('BROWSER_PREVIEW_TRANSPORT'));
}

const preview = createBrowserPreviewServer({
  port: Number(process.env.BROWSER_CHAT_PREVIEW_WS_PORT) || 18021,
  getConfiguration: browserRuntimeConfiguration,
  authorize: consumeWebSocketTicket,
  startScreencast: startBrowserChatScreencast,
  dispatchInput: dispatchBrowserChatPreviewInput,
});
export const ensureBrowserPreviewWebSocketServer = preview.ensure;
export const closeBrowserPreviewWebSocketServer = preview.close;
export const resetBrowserChatPreview = preview.resetSession;

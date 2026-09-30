import { createBrowserPreviewServer } from '@cjfclonedeep/capability-sdk/browser/preview/server';
import { consumeWebSocketTicket } from '@/server/auth/websocket-ticket';
import { dispatchBrowserChatPreviewInput, startBrowserChatScreencast } from '@/server/ai/agents/browser-chat.service';
export { browserPreviewPreferredTransport } from '@cjfclonedeep/capability-sdk/browser/preview/server';
const preview = createBrowserPreviewServer({
  port: Number(process.env.BROWSER_CHAT_PREVIEW_WS_PORT) || 18021,
  authorize: consumeWebSocketTicket,
  startScreencast: startBrowserChatScreencast,
  dispatchInput: dispatchBrowserChatPreviewInput,
});
export const ensureBrowserPreviewWebSocketServer = preview.ensure;
export const closeBrowserPreviewWebSocketServer = preview.close;

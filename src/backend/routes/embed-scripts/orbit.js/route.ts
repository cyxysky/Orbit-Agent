import { ORBIT_EMBED_SDK } from '@/embed/webpilot-sdk';
import { embedJavaScript, embedOptionsResponse } from '@/server/embed/browser-chat-embed';


export function OPTIONS() {
  return embedOptionsResponse();
}

export async function GET() {
  return embedJavaScript(ORBIT_EMBED_SDK);
}

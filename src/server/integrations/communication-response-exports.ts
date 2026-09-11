import type { CommunicationContent } from '@webpilot/capability-communication';
import type { BrowserChatMessage } from '@/server/ai/agents/browser-chat.service';
import { responseHandlers } from '@/server/capabilities/response-handlers';
import { communicationReplyContents } from './communication-reply';

/** Each package exports its own content; preserve the response's original order. */
export async function communicationReplyWithResponseExports(message: BrowserChatMessage, sessionId: string, userId: string): Promise<CommunicationContent[]> {
  const parts = message.parts?.filter(part => part.type === 'text' || part.type === 'data-response') || [];
  if (!parts.length) return communicationReplyContents(message);
  const replies: CommunicationContent[] = [];
  const appendText = (content: string) => {
    if (content.trim()) replies.push(...communicationReplyContents({ ...message, content, parts: [], artifacts: [] }));
  };
  for (const part of parts) {
    if (part.type === 'text') { appendText(part.text); continue; }
    if (part.type !== 'data-response') continue;
    try {
      for (const exported of await responseHandlers.export(part.data, { scopeId: sessionId, userId, readOnly: true })) {
        if (exported.format === 'markdown') appendText(exported.body);
        else replies.push(exported);
      }
    } catch {
      appendText('此内容导出失败，请在网页对话中查看。');
    }
  }
  // Artifacts are attached once, even when a response export returned the same image.
  for (const content of communicationReplyContents(message)) {
    if (content.format === 'markdown' || !('artifactId' in content)) continue;
    if (!replies.some(reply => 'artifactId' in reply && reply.artifactId === content.artifactId)) replies.push(content);
  }
  return replies.length ? replies : communicationReplyContents(message);
}

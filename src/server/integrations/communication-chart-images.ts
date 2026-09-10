import type { CommunicationContent } from '@webpilot/capability-communication';
import type { BrowserChatMessage } from '@/server/ai/agents/browser-chat.service';
import { exportBrowserChatChartImage } from '@/server/capabilities/browser-chat-chart-image';
import { communicationReplyContents } from './communication-reply';

export async function communicationReplyWithChartImages(message: BrowserChatMessage, sessionId: string, userId: string): Promise<CommunicationContent[]> {
  const replies = communicationReplyContents(message);
  const chartIds = new Set(message.parts?.flatMap(part => part.type === 'data-chart' ? [part.data.chartId] : []) || []);
  for (const chartId of chartIds) {
    try {
      const artifactId = await exportBrowserChatChartImage(sessionId, chartId, userId);
      if (artifactId && !replies.some(reply => 'artifactId' in reply && reply.artifactId === artifactId)) {
        replies.push({ format: 'image', artifactId });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知错误';
      replies.push({ format: 'markdown', body: `画布 ${chartId} 的 PNG 导出失败：${detail.slice(0, 500)}。画布仍可在网页对话中查看和编辑。` });
    }
  }
  return replies;
}

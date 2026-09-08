import { Readable } from 'node:stream';
import sharp from 'sharp';
import { artifactContentType } from '@webpilot/capability-file';
import type { WeComBotConnection } from '@webpilot/capability-communication/node';
import { browserChatAttachmentLimit } from '@/server/ai/agents/browser-chat-attachments';
import { storeUploadedFile, uploadMaxBytes } from '@/server/storage/upload-file';
import { saveCommunicationInbound, type CommunicationInbound } from '@/server/storage/communication-conversation-store';

/** Resolve expiring provider media into normal, account-owned browser attachments. */
export async function importCommunicationAttachments(item: CommunicationInbound, bot: WeComBotConnection, userId: string) {
  if ((item.attachments?.length || 0) + (item.media?.length || 0) > browserChatAttachmentLimit) {
    throw new Error(`每次最多接收 ${browserChatAttachmentLimit} 个附件，请分批发送。`);
  }
  while (item.media?.length) {
    const media = item.media[0];
    const { buffer, filename } = await bot.download(media);
    if (!buffer.length || buffer.length > uploadMaxBytes()) throw new Error('附件为空或超过上传大小限制，请重新发送。');
    let name = filename || `attachment-${item.id.slice(0, 12)}-${item.attachments?.length || 0}.${media.type === 'video' ? 'mp4' : 'bin'}`;
    let type = artifactContentType(name);
    if (media.type === 'image') {
      const metadata = await sharp(buffer).metadata();
      const format = metadata.format === 'jpg' ? 'jpeg' : metadata.format;
      if (!format) throw new Error('无法识别收到的图片格式。');
      type = `image/${format}`;
      if (!filename || !artifactContentType(name).startsWith('image/')) name = `image-${item.id.slice(0, 12)}-${item.attachments?.length || 0}.${format}`;
    }
    const upload = await storeUploadedFile({ userId, name, type, source: Readable.from([buffer]) });
    item.attachments = [...(item.attachments || []), { id: upload.fileId, name: upload.name, type: upload.type,
      size: upload.size, path: upload.path, url: upload.url, kind: type.startsWith('image/') ? 'image' : 'file' }];
    item.media = item.media.slice(1);
    // Persist after each download: later files/quota maintenance can already see ownership.
    await saveCommunicationInbound(item);
  }
}

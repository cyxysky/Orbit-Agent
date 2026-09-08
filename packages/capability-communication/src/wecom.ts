import type { CapabilityExecutionContext } from '@webpilot/capability-sdk';
import type { CommunicationContent, CommunicationMediaOperations, CommunicationTarget } from './index.js';

function requireByteLimit(value: string | undefined, maximum: number, label: string) {
  if (value && Buffer.byteLength(value, 'utf8') > maximum) {
    throw new Error(`${label}不能超过 ${maximum} 字节。`);
  }
}

export function validateWeComMessageContent(content: CommunicationContent) {
  if ('body' in content) {
    if (/!\[[^\]]*\]\s*(?:\(|\[)|<img\b/i.test(content.body)) {
      throw new Error('企业微信不能显示 Markdown 图片，请使用 image 消息并提供 artifactId 或真实 mediaId。文字说明请单独发送。');
    }
    const text = content.title?.trim() ? `### ${content.title.trim()}\n\n${content.body}` : content.body;
    requireByteLimit(text, 20_480, '企业微信 Markdown 消息');
    return;
  }
  if (Boolean(content.artifactId) === Boolean(content.mediaId)) {
    throw new Error('媒体消息必须提供 artifactId 或 mediaId，且只能提供一个。');
  }
  if (content.mediaId && /^(?:https?:|data:|\/)/i.test(content.mediaId)) {
    throw new Error('mediaId 必须是企业微信上传接口返回的标识，不能使用文件链接。');
  }
  if (content.format === 'video') {
    requireByteLimit(content.title, 128, '视频标题');
    requireByteLimit(content.description, 512, '视频描述');
  } else if (content.title || content.description) {
    throw new Error('图片、文件和语音消息不支持标题或描述字段，文字说明请另建文本消息。');
  }
}

export async function createWeComMessageArguments(input: {
  content: CommunicationContent;
  target: CommunicationTarget;
  context: CapabilityExecutionContext;
  media?: CommunicationMediaOperations;
}): Promise<Record<string, unknown>> {
  const { content, target, context, media } = input;
  validateWeComMessageContent(content);
  context.abortSignal?.throwIfAborted();
  if ('body' in content) {
    const text = content.title?.trim() ? `### ${content.title.trim()}\n\n${content.body}` : content.body;
    return { chat_id: target.id, msg_type: 'markdown', markdown: { content: text } };
  }
  let mediaId = content.mediaId;
  if (!mediaId) {
    if (!media) throw new Error('此渠道未接入机器人的媒体上传能力。请配置 Bot ID 和 Secret，或提供企业微信上传接口返回的真实 mediaId。');
    const file = await media.readArtifact(content.artifactId!, context);
    const mime = file.mediaType.split(';')[0].toLowerCase();
    if (content.format === 'image' && !mime.startsWith('image/')) throw new Error('图片消息必须使用图片文件。');
    if (content.format === 'video' && !mime.startsWith('video/')) throw new Error('视频消息必须使用视频文件。');
    if (content.format === 'voice' && mime !== 'audio/amr') {
      throw new Error('企业微信语音消息仅支持 AMR，请先转换格式，或改用 file 发送原始音频。');
    }
    context.abortSignal?.throwIfAborted();
    mediaId = await media.upload(file, content.format, context);
  }
  if (!mediaId?.trim()) throw new Error('媒体上传未返回 media_id，消息未发送。');
  return {
    chat_id: target.id,
    msg_type: content.format,
    [content.format]: {
      media_id: mediaId,
      ...(content.format === 'video' && content.title ? { title: content.title } : {}),
      ...(content.format === 'video' && content.description ? { description: content.description } : {}),
    },
  };
}

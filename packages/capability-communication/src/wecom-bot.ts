import { WSClient, type BaseMessage, type WsFrame } from '@wecom/aibot-node-sdk';
import type { CommunicationMediaFormat, CommunicationMediaOperations } from './index.js';
import { CommunicationDeliveryError } from './index.js';

export const WECOM_BOT_RUNTIME_REVISION = 5;

export type WeComInboundAttachment = {
  type: 'image' | 'file' | 'video';
  url: string;
  aesKey?: string;
};

export type WeComInboundMessage = {
  id: string;
  botId: string;
  senderId: string;
  target: { kind: 'user' | 'group'; id: string };
  text: string;
  media: WeComInboundAttachment[];
};

/** The leading mention addresses the bot in group callbacks; it is not Agent input. */
export function normalizeWeComMessageText(text: string, chatType: 'single' | 'group') {
  const content = text.trim();
  return chatType === 'group' ? content.replace(/^@[^\s@]+(?:\s+|$)/u, '').trim() : content;
}

export function normalizeWeComInboundMessage(
  body: BaseMessage | undefined, botId: string, rejected?: (reason: string) => void,
): WeComInboundMessage | undefined {
  const reject = (reason: string) => { rejected?.(reason); return undefined; };
  if (!body?.msgid) return reject('消息缺少 msgid');
  if (body.aibotid !== botId) return reject('消息的机器人 ID 与连接不一致');
  if (!body.from?.userid) return reject('消息缺少发送人 userid');
  if (!['single', 'group'].includes(body.chattype)) return reject('消息的 chattype 无效');
  const target = body.chattype === 'group'
    ? { kind: 'group' as const, id: body.chatid || '' }
    : { kind: 'user' as const, id: body.from.userid };
  if (!target.id) return reject('群聊消息缺少 chatid');
  const parts = body.msgtype === 'mixed' && Array.isArray(body.mixed?.msg_item) ? body.mixed.msg_item : [body];
  const texts: string[] = [];
  const media: WeComInboundAttachment[] = [];
  for (const part of parts) {
    if (part.msgtype === 'text' || part.msgtype === 'voice') {
      const content = part[part.msgtype]?.content;
      if (typeof content === 'string' && content.trim()) texts.push(content.trim());
    } else if (part.msgtype === 'image' || part.msgtype === 'file' || part.msgtype === 'video') {
      const content = part[part.msgtype];
      media.push({ type: part.msgtype, url: typeof content?.url === 'string' ? content.url : '',
        aesKey: typeof content?.aeskey === 'string' ? content.aeskey : undefined });
    }
  }
  const text = normalizeWeComMessageText(texts.join('\n'), body.chattype);
  if (!text && !media.length) return reject('消息没有可处理的文字或附件');
  return { id: body.msgid, botId, senderId: body.from.userid, target, text, media };
}

export function createWeComBotConnection(input: { botId: string; secret: string }) {
  const client = new WSClient({
    ...input, maxReconnectAttempts: -1,
    // SDK debug frames can contain credentials and message contents.
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  let authenticated = false;
  let started = false;
  let closed = false;
  let error = '';
  let displaced = false;
  let received = 0;
  let rejected = 0;
  let lastReceivedAt = '';
  let lastMessageError = '';
  const listeners = new Set<(message: WeComInboundMessage) => void>();
  client.on('authenticated', () => { authenticated = true; error = ''; });
  client.on('disconnected', () => { authenticated = false; });
  client.on('error', () => { error = '机器人连接失败，请检查 Bot ID、Secret 和网络。'; });
  client.on('event.disconnected_event', () => {
    error = '此机器人已被其他长连接客户端接管，请关闭重复运行的客户端后重新启用渠道。';
    displaced = true;
    authenticated = false;
    client.disconnect();
    started = false;
  });
  client.on('message', (frame: WsFrame<BaseMessage>) => {
    received += 1;
    lastReceivedAt = new Date().toISOString();
    const message = normalizeWeComInboundMessage(frame.body, input.botId, reason => {
      rejected += 1;
      lastMessageError = reason;
      // Log validation outcomes only, never raw frames, secrets or message text.
      console.warn('[wecom] 接收消息未通过校验：', reason);
    });
    if (!message) return;
    if (!listeners.size) {
      lastMessageError = '消息已到达，但没有接收处理器，请保存并启用渠道。';
      console.warn('[wecom]', lastMessageError);
      return;
    }
    lastMessageError = '';
    for (const listener of listeners) listener(message);
  });
  function connect() {
    if (closed) throw new Error('机器人连接已关闭。');
    if (displaced) throw new Error(error);
    if (!started) { started = true; client.connect(); }
  }
  async function ready(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (authenticated) return;
    await new Promise<void>((resolve, reject) => {
      const finish = (failure?: Error) => {
        clearTimeout(timer);
        client.off('authenticated', success);
        client.off('error', fail);
        signal?.removeEventListener('abort', abort);
        failure ? reject(failure) : resolve();
      };
      const success = () => finish();
      const fail = () => finish(new Error(error || '机器人认证失败。'));
      const abort = () => finish(new Error('机器人操作已取消。'));
      const timer = setTimeout(() => finish(new Error(error || '等待机器人连接超时。')), 20_000);
      client.once('authenticated', success);
      client.once('error', fail);
      signal?.addEventListener('abort', abort, { once: true });
      try { connect(); } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    });
  }
  const upload: CommunicationMediaOperations['upload'] = async (file, type, context) => {
    await ready(context.abortSignal);
    if (!file.data.length || file.data.length > 50 * 1024 * 1024) throw new Error('企微媒体文件必须大于 0 字节且不超过 50 MB。');
    const result = await client.uploadMedia(Buffer.from(file.data), { type, filename: file.fileName });
    context.abortSignal?.throwIfAborted();
    if (!result.media_id) throw new Error('企业微信上传未返回 media_id。');
    return result.media_id;
  };
  function verify(frame: WsFrame) {
    if (frame.errcode !== 0) throw new CommunicationDeliveryError(
      `企业微信发送${frame.errcode === undefined ? '未返回明确回执' : `被拒绝（errcode ${frame.errcode}）`}：${frame.errmsg || ''}`,
      frame.errcode === undefined ? 'unknown' : 'not-sent',
    );
    return frame;
  }
  async function send(operation: () => Promise<WsFrame>) {
    try { await ready(); }
    catch (error) { throw new CommunicationDeliveryError(error instanceof Error ? error.message : String(error), 'not-sent', { cause: error }); }
    try { return verify(await operation()); }
    catch (error) {
      if (error instanceof CommunicationDeliveryError) throw error;
      // The SDK rejects nonzero acknowledgements with the original frame.
      const frame = error as Partial<WsFrame> | undefined;
      if (typeof frame?.errcode === 'number' && frame.errcode !== 0) {
        throw new CommunicationDeliveryError(`企业微信拒绝发送（errcode ${frame.errcode}）：${frame.errmsg || ''}`, 'not-sent', { cause: error });
      }
      throw new CommunicationDeliveryError(error instanceof Error ? error.message : String(error), 'unknown', { cause: error });
    }
  }
  return {
    connect, ready, upload,
    async download(attachment: WeComInboundAttachment) {
      if (!/^https?:\/\//i.test(attachment.url)) throw new Error('企微附件未提供有效的下载地址，请重新发送。');
      try { return await client.downloadFile(attachment.url, attachment.aesKey); }
      catch (cause) { throw new Error('企微附件下载或解密失败，请重新发送附件。', { cause }); }
    },
    get status() { return { connected: authenticated, error, received, rejected, lastReceivedAt, lastMessageError }; },
    onMessage(listener: (message: WeComInboundMessage) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async sendText(targetId: string, content: string) {
      return send(() => client.sendMessage(targetId, { msgtype: 'markdown', markdown: { content } }));
    },
    async sendMedia(targetId: string, type: CommunicationMediaFormat, mediaId: string, video?: { title?: string; description?: string }) {
      return send(() => client.sendMediaMessage(targetId, type, mediaId, video));
    },
    close() { closed = true; authenticated = false; listeners.clear(); client.disconnect(); },
  };
}

export type WeComBotConnection = ReturnType<typeof createWeComBotConnection>;

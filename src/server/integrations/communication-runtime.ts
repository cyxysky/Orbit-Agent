import type { WeComBotConnection, WeComInboundMessage } from '@webpilot/capability-communication/node';
import { createWeComMessageArguments } from '@webpilot/capability-communication/node';
import {
  createBrowserChatSession, deleteBrowserChatSession, getBrowserChatSession,
  sendBrowserChatMessage, subscribeBrowserChatUIStream,
  type BrowserChatMessage,
} from '@/server/ai/agents/browser-chat.service';
import { communicationArtifactReader } from '@/server/storage/artifact-access';
import { readBrowserChatSessionSummaries } from '@/server/storage/database-record-store';
import { readBrowserChatSessionOwner } from '@/server/storage/browser-chat-history-store';
import { browserChatAttachmentLimit } from '@/server/ai/agents/browser-chat-attachments';
import {
  communicationId, readCommunicationConversation, saveCommunicationConversation,
  readCommunicationInbound,
  receiveCommunicationMessage, saveCommunicationInbound, listPendingCommunicationMessages,
  readWaitingCommunicationAttachments, consumeCommunicationAttachments, cancelCommunicationAttachments,
  type CommunicationConversation, type CommunicationInbound,
} from '@/server/storage/communication-conversation-store';
import { resolveExternalIntegrations, type ResolvedExternalIntegration } from './external-integration-vault';
import { closeUnusedWeComConnections, getWeComConnection } from './wecom-connections';
import { communicationReplyContents, splitCommunicationText } from './communication-reply';
import { importCommunicationAttachments } from './communication-attachments';

type Watcher = { item: CommunicationInbound; stop: () => void };
type Receiver = { integration: ResolvedExternalIntegration; bot: WeComBotConnection; stop: () => void };
type Runtime = {
  started: boolean; ticking: boolean; lastRefresh: number;
  refreshing?: Promise<void>;
  receivers: Map<string, Receiver>; watchers: Map<string, Watcher>;
  scheduled: Set<string>; queues: Map<string, Promise<void>>;
  timer?: ReturnType<typeof setTimeout>;
};
const state: Runtime = ((globalThis as typeof globalThis & { __orbitCommunicationRuntime?: Runtime }).__orbitCommunicationRuntime ??= {
  started: false, ticking: false, lastRefresh: 0,
  receivers: new Map(), watchers: new Map(), scheduled: new Set(), queues: new Map(),
});

function failureMessage(error: unknown) {
  const value = error as { errcode?: unknown; message?: unknown; errmsg?: unknown } | undefined;
  if (typeof value?.errcode === 'number') return `企业微信返回错误码 ${value.errcode}。`;
  return String(value?.message || value?.errmsg || '消息处理失败。')
    .replace(/https?:\/\/\S+/gi, '[服务地址]')
    .replace(/(apikey|secret|token)\s*[:=]\s*\S+/gi, '$1=[已隐藏]').slice(0, 300);
}

function enqueue(key: string, work: () => Promise<void>) {
  const next = (state.queues.get(key) || Promise.resolve()).then(work);
  const settled = next.catch(() => { console.error('[communication] 消息处理失败，详情已记录到接收任务。'); });
  state.queues.set(key, settled);
  void settled.finally(() => { if (state.queues.get(key) === settled) state.queues.delete(key); });
  return next;
}

async function receive(integration: ResolvedExternalIntegration, message: WeComInboundMessage) {
  const userId = integration.configuration.ownerUserId;
  if (!userId) return;
  const conversationId = communicationId(integration.id, message.botId, userId, message.target.kind, message.target.id);
  await enqueue(conversationId, async () => {
    let conversation = await readCommunicationConversation(conversationId);
    if (!conversation) {
      conversation = { id: conversationId, integrationId: integration.id, botId: message.botId, userId, target: message.target, sessions: [] };
    }
    await saveCommunicationConversation(conversation);
    if (integration.configuration.receiveMessages === 'true') {
      await receiveCommunicationMessage({
        id: communicationId(integration.id, message.botId, message.id), conversationId,
        text: message.text, senderId: message.senderId, status: 'received',
        media: message.media,
      });
    }
  });
  void tick();
}

async function reconcileConnections() {
  const integrations = (await resolveExternalIntegrations('communication'))
    .filter(item => item.driverId === 'wecom-aibot-mcp' && item.enabled && item.configuration.botId && item.configuration.botSecret);
  for (const [id, receiver] of state.receivers) {
    const integration = integrations.find(item => item.id === id);
    if (!integration || integration.updatedAt !== receiver.integration.updatedAt) {
      receiver.stop(); state.receivers.delete(id);
    }
  }
  closeUnusedWeComConnections(new Set(integrations.map(item => item.configuration.botId)));
  for (const integration of integrations) {
    const bot = getWeComConnection(integration);
    const receiver = state.receivers.get(integration.id);
    if (receiver?.bot === bot) continue;
    receiver?.stop();
    const stop = integration.configuration.ownerUserId
      ? bot.onMessage(message => { void receive(integration, message).catch(() => console.error('[communication] 无法持久化企微消息。')); })
      : () => {};
    state.receivers.set(integration.id, { integration, bot, stop });
    bot.connect();
  }
  for (const [id, watcher] of state.watchers) {
    if (watcher.item.sessionId && !await readBrowserChatSessionOwner(watcher.item.sessionId)) {
      watcher.stop(); state.watchers.delete(id);
      watcher.item.status = 'cancelled'; await saveCommunicationInbound(watcher.item);
    }
  }
  state.lastRefresh = Date.now();
}

function reconcile() {
  return state.refreshing ??= reconcileConnections().finally(() => { state.refreshing = undefined; });
}

function receiverFor(conversation: CommunicationConversation) {
  const receiver = state.receivers.get(conversation.integrationId);
  if (!receiver || receiver.integration.configuration.receiveMessages !== 'true'
    || receiver.integration.configuration.botId !== conversation.botId
    || receiver.integration.configuration.ownerUserId !== conversation.userId) return undefined;
  return receiver;
}

async function replyText(item: CommunicationInbound, text: string) {
  item.replies = splitCommunicationText(text).map(body => ({ content: { format: 'markdown', body }, status: 'pending' }));
  item.status = 'replying';
  await saveCommunicationInbound(item);
}

async function deliver(conversation: CommunicationConversation, item: CommunicationInbound) {
  const receiver = receiverFor(conversation);
  if (!receiver || item.status !== 'replying') return;
  // A crash after sending but before its receipt is persisted is ambiguous: never blindly resend it.
  if (item.replies?.some(reply => reply.status === 'sending')) {
    item.status = 'failed'; item.error = '回复发送结果未确认，未自动重发。';
    await saveCommunicationInbound(item);
    await receiver.bot.sendText(conversation.target.id, `上一条回复的送达状态未能确认，未自动重发。请在网页查看对话 ${item.sessionId || ''}。`).catch(() => {});
    return;
  }
  try {
    for (const reply of item.replies || []) {
      if (reply.status === 'sent') continue;
      if (item.sessionId) {
        const latest = await readCommunicationConversation(conversation.id);
        if (!latest?.sessions.some(session => session.id === item.sessionId)) {
          item.status = 'cancelled'; await saveCommunicationInbound(item); return;
        }
      }
      if ('body' in reply.content) {
        reply.status = 'sending'; await saveCommunicationInbound(item);
        await receiver.bot.sendText(conversation.target.id, reply.content.body);
      } else {
        const context = { invocationId: item.id };
        const args = await createWeComMessageArguments({
          content: reply.content, target: conversation.target, context,
          media: { readArtifact: communicationArtifactReader(conversation.userId), upload: receiver.bot.upload },
        });
        const body = args[reply.content.format] as { media_id: string; title?: string; description?: string };
        reply.status = 'sending'; await saveCommunicationInbound(item);
        await receiver.bot.sendMedia(conversation.target.id, reply.content.format, body.media_id, body);
      }
      reply.status = 'sent'; await saveCommunicationInbound(item);
    }
    item.status = 'done'; await saveCommunicationInbound(item);
  } catch (error) {
    item.status = 'failed'; item.error = failureMessage(error);
    await saveCommunicationInbound(item);
    await receiver.bot.sendText(conversation.target.id, `本轮回复未完整送达：${item.error}\n请在网页查看对话 ${item.sessionId || ''}，未自动重复发送。`).catch(() => {});
  }
}

async function finish(conversation: CommunicationConversation, item: CommunicationInbound, message: BrowserChatMessage) {
  const latest = await readCommunicationInbound(item.id);
  if (!latest) return;
  item = latest;
  if (item.status !== 'running') return;
  await consumeCommunicationAttachments(item.attachmentMessageIds || []);
  state.watchers.get(item.id)?.stop(); state.watchers.delete(item.id);
  item.replies = communicationReplyContents(message).map(content => ({ content, status: 'pending' }));
  item.status = 'replying'; await saveCommunicationInbound(item);
  await deliver(conversation, item);
}

function watch(conversation: CommunicationConversation, item: CommunicationInbound) {
  if (!item.sessionId || state.watchers.has(item.id)) return;
  const watcher = { item, stop: () => {} };
  state.watchers.set(item.id, watcher);
  watcher.stop = subscribeBrowserChatUIStream(item.sessionId, item.id, update => {
    const message = update.message;
    if (['passed', 'failed', 'interrupted'].includes(message?.status || '') || (message?.status === 'blocked' && update.pendingToolConfirmation?.messageId !== message.id)) {
      void enqueue(conversation.id, () => finish(conversation, item, message!)).catch(() => {});
    } else if (update.pendingToolConfirmation && update.pendingToolConfirmation.messageId === message?.id && !item.noticeSent) {
      void enqueue(conversation.id, async () => {
        const latest = await readCommunicationInbound(item.id);
        if (!latest || latest.status !== 'running' || latest.noticeSent) return;
        latest.noticeSent = true;
        item.noticeSent = true;
        await saveCommunicationInbound(latest);
        await receiverFor(conversation)?.bot.sendText(conversation.target.id,
          `对话 ${latest.sessionId} 有操作需要确认，请在网页对话中处理，确认后会继续回复。`);
      }).catch(() => {});
    }
  });
}

async function createSession(conversation: CommunicationConversation, item: CommunicationInbound) {
  const existing = item.sessionId ? await getBrowserChatSession(item.sessionId, conversation.userId) : undefined;
  const session = existing || await createBrowserChatSession({ userId: conversation.userId, title: '企业微信对话', safetyMode: 'full', selectRuntime: false });
  item.sessionId = session.id;
  await saveCommunicationInbound(item);
  if (!conversation.sessions.some(entry => entry.id === session.id)) conversation.sessions.push({ id: session.id, title: session.title });
  conversation.activeSessionId = session.id;
  await saveCommunicationConversation(conversation);
  return session.id;
}

async function processReceived(conversation: CommunicationConversation, item: CommunicationInbound) {
  const match = /^\/(start|delete|list|select)(?:\s+([^\s]+))?\s*$/i.exec(item.text);
  if (item.text.startsWith('/') && !item.media?.length && !item.attachments?.length) {
    if (!match || (match[1].toLowerCase() !== 'select' && match[2]) || (match[1].toLowerCase() === 'select' && !match[2])) {
      await replyText(item, '命令：/start 新建对话；/delete 删除当前对话；/list 列表；/select chat_xxx 切换对话。');
    } else {
      const command = match[1].toLowerCase();
      if (command === 'start') {
        const id = await createSession(conversation, item);
        await replyText(item, `已开启新对话：${id}。后续消息将在此对话继续，网页中也可查看。`);
      } else if (command === 'list') {
        const sessions = await readBrowserChatSessionSummaries<{ id: string; title: string }>({ userId: conversation.userId });
        if (!sessions.some(session => session.id === conversation.activeSessionId)) conversation.activeSessionId = undefined;
        await saveCommunicationConversation(conversation);
        await replyText(item, sessions.length ? sessions.map(session => `${session.id === conversation.activeSessionId ? '当前：' : ''}${session.id} · ${session.title || '新对话'}`).join('\n\n') : '当前网页账号还没有对话，发送消息或 /start 即可创建。');
      } else if (command === 'select') {
        const session = await getBrowserChatSession(match[2], conversation.userId);
        if (!session || session.status === 'closed') await replyText(item, '对话不存在、已关闭或不属于当前网页账号。请用 /list 查看可用 ID。');
        else {
          if (!conversation.sessions.some(entry => entry.id === session.id)) conversation.sessions.push({ id: session.id, title: session.title });
          conversation.activeSessionId = session.id; await saveCommunicationConversation(conversation);
          await replyText(item, `已切换到 ${session.id}：${session.title || '新对话'}。将保留原有上下文继续。`);
        }
      } else {
        const id = conversation.activeSessionId;
        if (!id) await replyText(item, '当前没有选中的对话。');
        else {
          for (const [key, watcher] of state.watchers) {
            if (watcher.item.sessionId !== id) continue;
            watcher.stop(); state.watchers.delete(key); watcher.item.status = 'cancelled';
            await saveCommunicationInbound(watcher.item);
          }
          await deleteBrowserChatSession(id, conversation.userId);
          await cancelCommunicationAttachments(id);
          conversation.sessions = conversation.sessions.filter(session => session.id !== id);
          conversation.activeSessionId = undefined; await saveCommunicationConversation(conversation);
          await replyText(item, `已删除对话 ${id}。下一条消息会创建新对话。`);
        }
      }
    }
    await deliver(conversation, item); return;
  }
  let sessionId = item.sessionId || conversation.activeSessionId;
  if (sessionId) {
    const session = await getBrowserChatSession(sessionId, conversation.userId);
    if (!session || session.status === 'closed') {
      if (item.sessionId) throw new Error('这条消息所属的对话已关闭或删除，请在当前对话重新发送。');
      sessionId = undefined;
    }
  }
  sessionId ||= await createSession(conversation, item);
  item.sessionId = sessionId;
  await saveCommunicationInbound(item);
  const receiver = receiverFor(conversation);
  if (!receiver) return;
  await importCommunicationAttachments(item, receiver.bot, conversation.userId);
  const waiting = await readWaitingCommunicationAttachments(conversation.id, sessionId, item.senderId);
  const attachments = [...new Map([...waiting.flatMap(entry => entry.attachments || []), ...(item.attachments || [])]
    .map(attachment => [attachment.id, attachment])).values()];
  if (attachments.length > browserChatAttachmentLimit) {
    throw new Error(`同一轮最多处理 ${browserChatAttachmentLimit} 个附件。已暂存的附件仍保留，请先发送文字处理上一批附件。`);
  }
  if (!item.text.trim()) {
    item.status = 'waiting';
    await saveCommunicationInbound(item);
    await receiver.bot.sendText(conversation.target.id, `已收到 ${item.attachments?.length || 0} 个附件，请继续发送文字说明要如何处理。`).catch(() => {});
    return;
  }
  item.attachments = attachments;
  item.attachmentMessageIds = waiting.map(entry => entry.id);
  item.sessionId = sessionId; item.status = 'running'; await saveCommunicationInbound(item);
  watch(conversation, item);
  try {
    await sendBrowserChatMessage(sessionId, item.text, 'full', undefined, undefined, item.id, attachments, undefined, conversation.userId);
  } catch (error) {
    state.watchers.get(item.id)?.stop(); state.watchers.delete(item.id);
    if (attachments.length) {
      item.status = 'waiting';
      await saveCommunicationInbound(item);
      await receiver.bot.sendText(conversation.target.id, `本轮未能开始：${failureMessage(error)}\n附件已保留，处理原因后可重新发送文字说明。`).catch(() => {});
    } else {
      await replyText(item, `本轮消息未能开始执行：${failureMessage(error)}\n请在网页对话 ${sessionId} 查看模型配置或消息队列状态。`);
      await deliver(conversation, item);
    }
    return;
  }
  await consumeCommunicationAttachments(item.attachmentMessageIds).catch(() => console.error('[communication] 暂存附件状态将在本轮完成时再次同步。'));
}

async function processItem(id: string) {
  // Polling may have queued this ID while a reply was still uploading/sending.
  // Read after acquiring the conversation queue, never execute a polling snapshot.
  const item = await readCommunicationInbound(id);
  if (!item || !['received', 'running', 'replying'].includes(item.status)) return;
  const conversation = await readCommunicationConversation(item.conversationId);
  if (!conversation || !receiverFor(conversation)) return;
  if (item.status === 'received') return processReceived(conversation, item);
  if (item.status === 'replying') return deliver(conversation, item);
  // Recover completed output after restart. Do not repeat interrupted tools.
  const session = item.sessionId ? await getBrowserChatSession(item.sessionId, conversation.userId) : undefined;
  const message = session?.messages.find(message => message.role === 'assistant' && message.clientMessageId === item.id);
  if (message && ['passed', 'failed', 'interrupted', 'blocked'].includes(message.status || '')) {
    await consumeCommunicationAttachments(item.attachmentMessageIds || []);
    return finish(conversation, item, message);
  }
  await replyText(item, `服务重启或连接恢复前的执行未完成，请在网页对话 ${item.sessionId || ''} 查看后重新发送消息。上下文已保留，未重复执行工具。`);
  await deliver(conversation, item);
}

async function tick() {
  if (state.ticking) return;
  state.ticking = true;
  try {
    if (Date.now() - state.lastRefresh > 15_000) await reconcile();
    const receiving = [...state.receivers.values()].filter(receiver => receiver.integration.configuration.receiveMessages === 'true').map(({ integration }) => ({
      id: integration.id, botId: integration.configuration.botId, userId: integration.configuration.ownerUserId,
    }));
    for (const item of await listPendingCommunicationMessages(receiving)) {
      if (state.watchers.has(item.id) || state.scheduled.has(item.id)) continue;
      state.scheduled.add(item.id);
      void enqueue(item.conversationId, async () => {
        try { await processItem(item.id); }
        catch (error) {
          const latest = await readCommunicationInbound(item.id);
          if (!latest || !['received', 'running', 'replying'].includes(latest.status)) return;
          latest.status = 'failed'; latest.error = failureMessage(error); await saveCommunicationInbound(latest);
          const conversation = await readCommunicationConversation(latest.conversationId);
          if (conversation) await receiverFor(conversation)?.bot.sendText(conversation.target.id, `消息处理失败：${latest.error}`).catch(() => {});
        }
      }).finally(() => { state.scheduled.delete(item.id); }).catch(() => console.error('[communication] 无法保存接收任务状态。'));
    }
  } catch { console.error('[communication] 机器人消息循环暂时不可用，将重试。'); }
  finally { state.ticking = false; }
}

export function startCommunicationRuntime() {
  if (state.started || process.env.WEBPILOT_SERVER_ROLE === 'ui') return;
  state.started = true;
  const schedule = () => {
    state.timer = setTimeout(() => { void tick().finally(schedule); }, 1_000);
    state.timer.unref?.();
  };
  void tick().finally(schedule);
}

export async function refreshCommunicationRuntime() {
  startCommunicationRuntime();
  await reconcile();
}

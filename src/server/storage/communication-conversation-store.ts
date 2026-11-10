import { workspaceEntities, workspaceRecords } from './record-sources';
import { createHash } from 'node:crypto';
import type { WeComInboundMessage, WeComInboundAttachment } from '@cjfclonedeep/capability-sdk/integrations/communication/node';
import type { BrowserChatAttachment } from '@/server/ai/agents/browser-chat-attachments';
import type { CommunicationContent } from '@cjfclonedeep/capability-sdk/integrations/communication';
import { executeDatabase, queryDatabase, queryDatabaseOne } from '@/server/db/database';
import type { RuntimeModelSelection } from '@/lib/model-selection';

export type CommunicationConversation = {
  id: string; integrationId: string; botId: string; userId: string;
  target: WeComInboundMessage['target']; activeSessionId?: string;
  sessions: Array<{ id: string; title: string }>;
  modelSelection?: RuntimeModelSelection;
};
export type CommunicationInbound = {
  id: string; conversationId: string; text: string; senderId: string;
  status: 'received' | 'waiting' | 'running' | 'replying' | 'done' | 'failed' | 'cancelled';
  sessionId?: string;
  replies?: Array<{ content: CommunicationContent; status: 'pending' | 'sending' | 'sent' }>;
  error?: string;
  media?: WeComInboundAttachment[];
  attachments?: BrowserChatAttachment[];
  attachmentMessageIds?: string[];
  confirmationNotice?: { id: string; status: 'sending' | 'sent' | 'unknown' };
  replyStream?: {
    requestId: string; id: string; startedAt: number;
    status: 'opening' | 'open' | 'finished' | 'unavailable';
    error?: string;
  };
};
export function communicationId(...parts: string[]) { return createHash('sha256').update(JSON.stringify(parts)).digest('hex'); }
export async function readCommunicationConversation(id: string) {
  const row = await queryDatabaseOne<{ record_json: string }>(`SELECT record_json FROM ${workspaceEntities('communication')} WHERE id = ?`, [id]);
  return row ? JSON.parse(row.record_json) as CommunicationConversation : undefined;
}

export async function readCommunicationInbound(id: string) {
  const row = await queryDatabaseOne<{ record_json: string }>(`SELECT record_json FROM ${workspaceRecords('communication')} WHERE id = ?`, [id]);
  return row ? JSON.parse(row.record_json) as CommunicationInbound : undefined;
}

export async function listCommunicationConversations(integrationId: string, botId: string) {
  const rows = await queryDatabase<{ record_json: string }>(
    `SELECT record_json FROM ${workspaceEntities('communication')} WHERE integration_id = ? AND bot_id = ? ORDER BY updated_at DESC`, [integrationId, botId]);
  return rows.map(row => JSON.parse(row.record_json) as CommunicationConversation);
}
export async function saveCommunicationConversation(value: CommunicationConversation) {
  await executeDatabase(`INSERT INTO workspace_entity (kind,id, integration_id, bot_id, user_id, record_json, updated_at) VALUES ('communication',?, ?, ?, ?, ?, ?)
    ON CONFLICT(kind,id) DO UPDATE SET record_json = excluded.record_json, updated_at = excluded.updated_at`,
  [value.id, value.integrationId, value.botId, value.userId, JSON.stringify(value), new Date().toISOString()]);
}
export async function receiveCommunicationMessage(value: CommunicationInbound) {
  const previous = await queryDatabaseOne<{ created_at: string }>(`SELECT created_at FROM ${workspaceRecords('communication')} WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1`, [value.conversationId]);
  const now = new Date(Math.max(Date.now(), previous ? Date.parse(previous.created_at) + 1 : 0)).toISOString();
  await executeDatabase(`INSERT INTO workspace_record (collection,kind,id, partition_id, status, record_json, created_at, updated_at)
    VALUES ('communication','inbound',?, ?, ?, ?, ?, ?) ON CONFLICT(id) WHERE collection='communication' DO NOTHING`, [value.id, value.conversationId, value.status, JSON.stringify(value), now, now]);
}

export async function readCommunicationConfirmationSource(conversationId: string, confirmationId: string) {
  const rows = await queryDatabase<{ record_json: string }>(
    `SELECT record_json FROM ${workspaceRecords('communication')} WHERE conversation_id = ? AND status = 'running'`, [conversationId]);
  return rows.map(row => JSON.parse(row.record_json) as CommunicationInbound)
    .find(item => item.confirmationNotice?.id === confirmationId);
}

export async function readWaitingCommunicationAttachments(conversationId: string, sessionId: string, senderId: string) {
  const rows = await queryDatabase<{ record_json: string }>(
    `SELECT record_json FROM ${workspaceRecords('communication')} WHERE conversation_id = ? AND status = 'waiting' ORDER BY created_at, id`, [conversationId]);
  return rows.map(row => JSON.parse(row.record_json) as CommunicationInbound)
    .filter(item => item.sessionId === sessionId && item.senderId === senderId);
}

export async function consumeCommunicationAttachments(ids: string[]) {
  for (const id of ids) {
    const row = await queryDatabaseOne<{ record_json: string }>(`SELECT record_json FROM ${workspaceRecords('communication')} WHERE id = ? AND status = 'waiting'`, [id]);
    if (row) await saveCommunicationInbound({ ...JSON.parse(row.record_json) as CommunicationInbound, status: 'done' });
  }
}

export async function cancelCommunicationAttachments(sessionId: string) {
  const rows = await queryDatabase<{ record_json: string }>(`SELECT record_json FROM ${workspaceRecords('communication')} WHERE status = 'waiting'`);
  for (const row of rows) {
    const item = JSON.parse(row.record_json) as CommunicationInbound;
    if (item.sessionId === sessionId) await saveCommunicationInbound({ ...item, status: 'cancelled' });
  }
}
export async function saveCommunicationInbound(value: CommunicationInbound) {
  await executeDatabase(`UPDATE workspace_record SET status = ?, record_json = ?, updated_at = ? WHERE collection='communication' AND id = ?`,
    [value.status, JSON.stringify(value), new Date().toISOString(), value.id]);
}
export async function listPendingCommunicationMessages(receivers: Array<{ id: string; botId: string; userId: string }>) {
  if (!receivers.length) return [];
  const rows = await queryDatabase<{ record_json: string }>(`SELECT m.record_json FROM ${workspaceRecords('communication')} m
    JOIN ${workspaceEntities('communication')} c ON c.id = m.conversation_id
    WHERE m.status IN ('received', 'running', 'replying') AND (${receivers.map(() => '(c.integration_id = ? AND c.bot_id = ? AND c.user_id = ?)').join(' OR ')})
    ORDER BY CASE WHEN m.status = 'running' THEN 1 ELSE 0 END, m.created_at, m.id LIMIT 200`, receivers.flatMap(receiver => [receiver.id, receiver.botId, receiver.userId]));
  return rows.map(row => JSON.parse(row.record_json) as CommunicationInbound);
}

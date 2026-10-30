import { executeDatabase, queryDatabaseOne, runDatabaseTransaction } from '@/server/db/database';
import { updateAutomationRunIfStatus } from '@/server/storage/automation-store';
import { publishRealtimeRefreshEvent } from '@/server/realtime/ws-refresh';
import type { ExecutionTask } from '@/server/runtime/execution-ownership';
import type { BrowserChatSubagentRecord } from '@/server/ai/schemas/runtime.schema';

export async function recoverExecutionTasks(tasks: ExecutionTask[]) {
  const timestamp = new Date().toISOString();
  const reason = '执行进程已退出，任务已中断。已保留历史记录，不会自动重放工具操作。';
  const expiredPageReason = '执行进程已退出，此前的子 Agent 人工处理页面已失效，无法从该暂停点继续。已保留历史结果和工具记录。';
  const recoveredChatSessions = new Set<string>();
  for (const task of tasks) {
    if (task.kind === 'automation') {
      await updateAutomationRunIfStatus(task.id, ['running', 'queued'], { status: 'cancelled', error: reason, finishedAt: timestamp, lease: null });
      continue;
    }
    if (recoveredChatSessions.has(task.id)) continue;
    recoveredChatSessions.add(task.id);
    let userId: string | undefined;
    await runDatabaseTransaction(async manager => {
      const row = await queryDatabaseOne<{ snapshot_json: string; summary_json: string; user_id: string }>(
        'SELECT snapshot_json, summary_json, user_id FROM browser_chat_session WHERE id = ?', [task.id], manager);
      if (!row) return;
      userId = row.user_id;
      const previous = JSON.parse(row.snapshot_json);
      const affectedSubagents = (previous.subagents || []).filter((agent: BrowserChatSubagentRecord) =>
        agent.status === 'running' || agent.status === 'queued' || (agent.status === 'blocked' && agent.resumable));
      const interruptedMessageIds = new Set<string>([
        ...tasks.flatMap(other => other.kind === 'chat' && other.id === task.id && other.turnId ? [other.turnId] : []),
        ...affectedSubagents.map((agent: BrowserChatSubagentRecord) => agent.messageId),
        ...(previous.queuedTurns || []).map((turn: { userMessageId: string }) => turn.userMessageId),
      ]);
      // A paused main browser has no active turnId and no child record. Its
      // assistant lives in the separate message table rather than the header.
      if (!task.turnId && previous.turnState === 'awaiting_human' && !affectedSubagents.length) {
        const latest = await queryDatabaseOne<{ id: string; record_json: string }>(
          'SELECT id, record_json FROM browser_chat_message WHERE session_id = ? ORDER BY time DESC LIMIT 1', [task.id], manager);
        if (latest) {
          const message = JSON.parse(latest.record_json);
          if (message.role === 'assistant' && message.status === 'blocked') interruptedMessageIds.add(latest.id);
        }
      }
      const patchMessage = <T extends { id: string; status?: string }>(value: T) =>
        interruptedMessageIds.has(value.id) && ['running', 'queued', 'blocked'].includes(value.status || '')
          ? { ...value, status: 'interrupted', activity: undefined, responseDraft: undefined, updatedAt: timestamp } : value;
      const patchSubagent = (agent: BrowserChatSubagentRecord) => {
        const stopped = agent.status === 'running' || agent.status === 'queued';
        const expired = agent.status === 'blocked' && agent.resumable;
        if (!stopped && !expired) return agent;
        const error = expired ? expiredPageReason : reason;
        return { ...agent, status: stopped ? 'stopped' : agent.status, resumable: false, currentAction: undefined,
          error: agent.error && !agent.error.includes(error) ? `${agent.error}\n\n${error}` : agent.error || error,
          updatedAt: timestamp };
      };
      const patch = (json: string) => {
        const value = JSON.parse(json);
        const closed = value.status === 'closed';
        return { ...value, busy: false, status: closed ? 'closed' : 'idle', turnState: closed ? 'closed' : 'interrupted',
          ...(!closed ? { error: reason } : {}),
          ...(value.messages ? { messages: value.messages.map(patchMessage) } : {}),
          ...(value.subagents ? { subagents: value.subagents.map(patchSubagent) } : {}),
          activeAssistantMessageId: undefined, pendingToolConfirmation: undefined, queuedTurns: [], updatedAt: timestamp };
      };
      const snapshot = patch(row.snapshot_json);
      await executeDatabase('UPDATE browser_chat_session SET status = ?, snapshot_json = ?, summary_json = ?, updated_at = ?, revision = revision + 1 WHERE id = ?',
        [snapshot.status, JSON.stringify(snapshot), JSON.stringify(patch(row.summary_json)), timestamp, task.id], manager);
      for (const messageId of interruptedMessageIds) {
        const message = await queryDatabaseOne<{ record_json: string }>('SELECT record_json FROM browser_chat_message WHERE session_id = ? AND id = ?', [task.id, messageId], manager);
        if (message) {
          const value = JSON.parse(message.record_json);
          const patched = patchMessage(value);
          if (patched !== value) await executeDatabase('UPDATE browser_chat_message SET record_json = ? WHERE session_id = ? AND id = ?',
            [JSON.stringify(patched), task.id, messageId], manager);
        }
      }
    });
    if (userId) await publishRealtimeRefreshEvent({ entityType: 'browserChatSession', userId, id: task.id, updatedAt: timestamp })
      .catch(error => console.warn('[execution] Recovery persisted; refresh notification failed', error.message));
  }
}

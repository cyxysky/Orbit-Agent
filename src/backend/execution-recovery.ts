import { executeDatabase, queryDatabaseOne, runDatabaseTransaction } from '@/server/db/database';
import { updateAutomationRunIfStatus } from '@/server/storage/automation-store';
import { publishRealtimeRefreshEvent } from '@/server/realtime/ws-refresh';
import type { ExecutionTask } from '@/server/runtime/execution-ownership';
import type { BrowserChatSubagentRecord } from '@/server/ai/schemas/runtime.schema';

export async function recoverExecutionTasks(tasks: ExecutionTask[]) {
  const timestamp = new Date().toISOString();
  const reason = '执行进程已退出，任务已中断。已保留历史记录，不会自动重放工具操作。';
  for (const task of tasks) {
    if (task.kind === 'automation') {
      await updateAutomationRunIfStatus(task.id, ['running', 'queued'], { status: 'cancelled', error: reason, finishedAt: timestamp, lease: null });
      continue;
    }
    let userId: string | undefined;
    await runDatabaseTransaction(async manager => {
      const row = await queryDatabaseOne<{ snapshot_json: string; summary_json: string; user_id: string }>(
        'SELECT snapshot_json, summary_json, user_id FROM browser_chat_session WHERE id = ?', [task.id], manager);
      if (!row) return;
      userId = row.user_id;
      const previous = JSON.parse(row.snapshot_json);
      const interruptedMessageIds = new Set<string>([
        ...(task.turnId ? [task.turnId] : []),
        ...(previous.queuedTurns || []).map((turn: { userMessageId: string }) => turn.userMessageId),
      ]);
      const patchMessage = <T extends { id: string; status?: string }>(value: T) =>
        interruptedMessageIds.has(value.id) && (value.status === 'running' || value.status === 'queued')
          ? { ...value, status: 'interrupted', updatedAt: timestamp } : value;
      const patch = (json: string) => {
        const value = JSON.parse(json);
        if (value.status === 'closed') return value;
        return { ...value, busy: false, status: 'idle', turnState: 'interrupted', error: reason,
          ...(value.messages ? { messages: value.messages.map(patchMessage) } : {}),
          ...(value.subagents ? { subagents: value.subagents.map((agent: BrowserChatSubagentRecord) =>
            agent.status === 'running' || agent.status === 'queued'
              ? { ...agent, status: 'stopped', error: reason, updatedAt: timestamp } : agent) } : {}),
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

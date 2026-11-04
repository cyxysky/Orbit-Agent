import { queryDatabaseOne, executeDatabase, runDatabaseTransaction } from '@/server/db/database';
import { ensureRuntimeOwner } from '@/server/storage/runtime-owner';
import type { ModelMessage } from 'ai';
import type { RuntimeRequestContextStats } from './runtime-context-budget';
import type { CodexDynamicTool } from '../codex-app-server';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';


export type CodexRuntimeBinding = {
  version: 1;
  revision: number;
  userId: string;
  threadId: string;
  transport: 'native' | 'model-bridge';
  toolsHash: string;
  registeredTools?: CodexDynamicTool[];
  lastClientTurnId?: string;
  lastTurnStatus?: string;
  contextUsage?: RuntimeRequestContextStats;
  pendingMigration?: unknown[];
  pendingRecovery?: unknown[];
  pendingDeliveries?: Record<string, ModelMessage[]>;
};

export async function readCodexRuntimeBinding(sessionId: string, scope: string, userId?: string) {
  const row = await queryDatabaseOne<{ record_json: string }>(
    'SELECT record_json FROM agent_runtime_state WHERE session_id = ? AND scope_id = ?', [sessionId, `codex-app-server:${scope}`],
  );
  if (!row) return;
  const binding = JSON.parse(row.record_json) as CodexRuntimeBinding;
  if (binding.version !== 1 || !binding.threadId || binding.userId !== (userId || 'local')) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Invalid Codex thread ownership binding.');
  return binding;
}

export async function writeCodexRuntimeBinding(sessionId: string, scope: string, binding: CodexRuntimeBinding) {
  const previous = binding.revision;
  const next = { ...binding, revision: previous + 1 };
  if (!previous) {
    await runDatabaseTransaction(async executor => {
      await ensureRuntimeOwner(sessionId, executor);
      await executeDatabase('INSERT INTO agent_runtime_state (session_id, scope_id, revision, record_json) VALUES (?, ?, ?, ?)',
        [sessionId, `codex-app-server:${scope}`, next.revision, JSON.stringify(next)], executor);
    });
  } else {
    const row = await queryDatabaseOne<{ revision: number }>(
      'UPDATE agent_runtime_state SET revision = ?, record_json = ? WHERE session_id = ? AND scope_id = ? AND revision = ? RETURNING revision',
      [next.revision, JSON.stringify(next), sessionId, `codex-app-server:${scope}`, previous],
    );
    if (!row) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Another writer changed this Codex thread binding.');
  }
  return next;
}

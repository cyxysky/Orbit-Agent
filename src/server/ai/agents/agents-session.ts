import type { AgentInputItem, Session } from '@openai/agents-core';
import { createHash } from 'node:crypto';
import { CodedError, ERROR_CODES } from '@cjfclonedeep/capability-sdk';
import { queryDatabaseOne, executeDatabase, runDatabaseTransaction } from '@/server/db/database';
import { ensureRuntimeOwner } from '@/server/storage/runtime-owner';

type PausedRun = { turnId: string; state: string; preparedInput: AgentInputItem[]; sourceInputCount: number };
type StoredSession = { userId: string; revision: number; history: AgentInputItem[]; continuationSummary: string; paused?: PausedRun };

/** One durable model history per owner/session/scope, using the existing execution collection. */
export class OrbitAgentSession implements Session {
  private state: StoredSession;
  private writes: Promise<unknown> = Promise.resolve();
  private constructor(readonly sessionId: string, readonly scope: string, readonly userId: string, state?: StoredSession) {
    this.state = state || { userId, revision: 0, history: [], continuationSummary: '' };
  }
  static async open(sessionId: string, scope: string, userId = 'local') {
    const row = await queryDatabaseOne<{ record_json: string }>(
      `SELECT record_json FROM workspace_record WHERE collection='execution' AND owner_kind='runtime' AND partition_id=? AND scope_id=? AND kind='state' AND id='current'`,
      [sessionId, `agents-sdk:${scope}`]);
    const state: StoredSession | undefined = row ? JSON.parse(row.record_json) : undefined;
    if (state && state.userId !== userId) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Agent session owner does not match the current user.');
    return new OrbitAgentSession(sessionId, scope, userId, state);
  }
  get exists() { return this.state.revision > 0; }
  get continuationSummary() { return this.state.continuationSummary; }
  get paused() { return this.state.paused; }
  async getSessionId() { return createHash('sha256').update(JSON.stringify([this.userId, this.sessionId, this.scope])).digest('hex'); }
  async getItems(limit?: number) { return structuredClone(limit === undefined ? this.state.history : limit > 0 ? this.state.history.slice(-limit) : []); }
  private async update(mutate: (state: StoredSession) => void) {
    const operation = this.writes.then(async () => {
      const previous = this.state.revision;
      const next = { ...this.state, revision: previous + 1 };
      mutate(next);
      await runDatabaseTransaction(async executor => {
        if (!previous) {
          await ensureRuntimeOwner(this.sessionId, executor);
          await executeDatabase(`INSERT INTO workspace_record(collection,owner_kind,partition_id,scope_id,kind,id,revision,record_json) VALUES ('execution','runtime',?,?,'state','current',?,?)`,
            [this.sessionId, `agents-sdk:${this.scope}`, next.revision, JSON.stringify(next)], executor);
        } else {
          const row = await queryDatabaseOne<{ revision: number }>(
            `UPDATE workspace_record SET revision=?,record_json=? WHERE collection='execution' AND owner_kind='runtime' AND partition_id=? AND scope_id=? AND kind='state' AND id='current' AND revision=? RETURNING revision`,
            [next.revision, JSON.stringify(next), this.sessionId, `agents-sdk:${this.scope}`, previous], executor);
          if (!row) throw new CodedError(ERROR_CODES.AI_RUNTIME_FAILED, 'Another writer changed this Agent session.');
        }
      });
      this.state = next;
    });
    // A failed checkpoint must prevent subsequent writes and tool side effects in this instance.
    this.writes = operation;
    await operation;
  }
  async addItems(items: AgentInputItem[]) { await this.update(state => { state.history = [...state.history, ...structuredClone(items)]; }); }
  async replaceHistoryWithCompaction(items: AgentInputItem[]) { await this.update(state => { state.history = structuredClone(items); }); }
  async popItem() {
    let item: AgentInputItem | undefined;
    await this.update(state => { state.history = [...state.history]; item = state.history.pop(); });
    return item;
  }
  async clearSession() { await this.update(state => { state.history = []; state.continuationSummary = ''; delete state.paused; }); }
  async checkpoint(items: AgentInputItem[], continuationSummary = this.continuationSummary) {
    await this.update(state => { state.history = structuredClone(items); state.continuationSummary = continuationSummary; });
  }
  async pause(paused: PausedRun) { await this.update(state => { state.paused = structuredClone(paused); }); }
  async finish() { await this.update(state => { delete state.paused; }); }
}

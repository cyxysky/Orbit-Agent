import { randomUUID } from 'node:crypto';
import type { ModelMessage } from 'ai';
import { queryDatabaseOne, queryDatabase, executeDatabase, runDatabaseTransaction, type DatabaseExecutor } from '@/server/db/database';

type Pending = { id: string; phase: 'planned' | 'awaiting-approval' | 'executing' | 'uncertain' | 'completed'; messages: ModelMessage[]; calls: Array<{ toolCallId: string; toolName: string; input: unknown }>; results: ModelMessage[]; startedCallIds?: string[] };
export type RuntimeJournalState = { revision: number; pending?: Pending; observations?: unknown };
export class RuntimeExecutionJournal {
  state: RuntimeJournalState = { revision: 0 };
  constructor(readonly sessionId: string, readonly scopeId = 'main') {}
  async load() {
    const row = await queryDatabaseOne<{ record_json: string }>('SELECT record_json FROM agent_runtime_state WHERE session_id = ? AND scope_id = ?', [this.sessionId, this.scopeId]);
    this.state = row ? JSON.parse(row.record_json) : { revision: 0 };
    return this.state;
  }
  async save(event: string, mutate: (next: RuntimeJournalState) => void, effect?: (executor: DatabaseExecutor) => Promise<void>) {
    const previous = this.state.revision;
    const next = structuredClone(this.state); mutate(next); next.revision++;
    await runDatabaseTransaction(async executor => {
      if (!previous) await executeDatabase('INSERT INTO agent_runtime_state (session_id, scope_id, revision, record_json) VALUES (?, ?, ?, ?)', [this.sessionId, this.scopeId, next.revision, JSON.stringify(next)], executor);
      else {
        const rows = await queryDatabase('UPDATE agent_runtime_state SET revision = ?, record_json = ? WHERE session_id = ? AND scope_id = ? AND revision = ? RETURNING session_id', [next.revision, JSON.stringify(next), this.sessionId, this.scopeId, previous], executor);
        if (!rows.length) throw new Error('Agent runtime revision conflict; another writer owns this state.');
      }
      await effect?.(executor);
      await executeDatabase('INSERT INTO agent_runtime_event (session_id, scope_id, revision, event_json) VALUES (?, ?, ?, ?)', [this.sessionId, this.scopeId, next.revision, JSON.stringify({ event, at: new Date().toISOString(), pending: next.pending, observations: event === 'observation' ? next.observations : undefined })], executor);
    });
    this.state = next;
  }
  async recover() {
    await this.load();
    if (!this.state.pending) return [];
    await this.completeInterruptedExchange();
    return [...this.state.pending!.messages, ...this.state.pending!.results];
  }
  private async completeInterruptedExchange() {
    const pending = this.state.pending;
    if (!pending) return;
    const recorded = new Set(pending.results.flatMap(message => message.role === 'tool'
      ? message.content.flatMap(part => part.type === 'tool-result' ? [part.toolCallId] : []) : []));
    if (pending.calls.every(call => recorded.has(call.toolCallId))) return;
    await this.save('interrupted_exchange_recorded', n => {
      const recordedIds = new Set(n.pending!.results.flatMap(message => message.role === 'tool'
        ? message.content.flatMap(part => part.type === 'tool-result' ? [part.toolCallId] : []) : []));
      for (const call of pending.calls) {
        if (recordedIds.has(call.toolCallId)) continue;
        const unexecuted = pending.startedCallIds
          ? !pending.startedCallIds.includes(call.toolCallId)
          : pending.phase === 'planned' || pending.phase === 'awaiting-approval';
        n.pending!.results.push({ role: 'tool', content: [{ type: 'tool-result', toolCallId: call.toolCallId, toolName: call.toolName,
          output: { type: 'error-json', value: { outcome: unexecuted ? 'not-executed' : 'unknown',
            reason: unexecuted ? 'Interrupted before execution.' : 'Execution was interrupted without a recorded result.',
            next: 'Inspect current state and make a new decision. This receipt does not establish business success; the previous call is not replayed.' } } }] });
      }
      n.pending!.phase = 'completed';
    });
  }
  async plan(messages: ModelMessage[], calls: Pending['calls']) {
    if (this.state.pending) throw new Error('Cannot replace an uncheckpointed tool exchange.');
    if (new Set(calls.map(call => call.toolCallId)).size !== calls.length) throw new Error('Duplicate tool call IDs in decision.');
    await this.save('model_planned', n => { n.pending = { id: randomUUID(), phase: 'planned', messages, calls, results: [], startedCallIds: [] }; }, async executor => {
      for (const call of calls) await executeDatabase('INSERT INTO agent_runtime_call (session_id, scope_id, call_id) VALUES (?, ?, ?)', [this.sessionId, this.scopeId, call.toolCallId], executor);
    });
  }
  async begin(callId?: string) {
    await this.save('execution_started', n => {
      const pending = n.pending;
      const id = callId ?? (pending?.calls.length === 1 ? pending.calls[0].toolCallId : undefined);
      if (!pending || !id || !pending.calls.some(call => call.toolCallId === id)
        || pending.startedCallIds?.includes(id)
        || pending.results.some(message => message.role === 'tool' && message.content.some(part => part.type === 'tool-result' && part.toolCallId === id))) {
        throw new Error('No unexecuted planned tool call to execute.');
      }
      (pending.startedCallIds ??= []).push(id);
      pending.phase = 'executing';
    });
  }
  async result(message: ModelMessage, uncertain = false, observations?: unknown) {
    await this.save(uncertain ? 'execution_uncertain' : 'tool_result', n => {
      if (!n.pending) throw new Error('Missing pending decision.');
      n.pending.results.push(message);
      if (observations) n.observations = observations;
      const recordedIds = new Set(n.pending.results.flatMap(result => result.role === 'tool'
        ? result.content.flatMap(part => part.type === 'tool-result' ? [part.toolCallId] : []) : []));
      n.pending.phase = n.pending.calls.every(call => recordedIds.has(call.toolCallId)) ? 'completed' : 'planned';
    });
  }
  async clear() {
    await this.completeInterruptedExchange();
    if (this.state.pending) await this.save('exchange_checkpointed', n => { delete n.pending; });
  }
}

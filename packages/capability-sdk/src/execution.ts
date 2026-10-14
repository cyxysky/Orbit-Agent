import type { CapabilityExecutionContext, CapabilityProgressEvent, ResolvedCapabilityTool } from './index.ts';
import { CapabilityTaskQueue } from './task-queue.ts';

export type CapabilityExecutionPolicyOptions = {
  authorize?(permissions: readonly string[], tool: ResolvedCapabilityTool, context: CapabilityExecutionContext): void | Promise<void>;
  prerequisite?(name: string, tool: ResolvedCapabilityTool, context: CapabilityExecutionContext): void | Promise<void>;
  reportProgress?(event: CapabilityProgressEvent, context: CapabilityExecutionContext): void | Promise<void>;
};

/** One executor per mounted run; serial groups stay locked until the operation actually ends. */
export function createCapabilityExecutor(options: CapabilityExecutionPolicyOptions = {}) {
  const queues = new Map<string, CapabilityTaskQueue>();
  return async <T>(tool: ResolvedCapabilityTool, context: CapabilityExecutionContext, invoke: (context: CapabilityExecutionContext) => Promise<T>): Promise<T> => {
    const run = async (abortSignal = context.abortSignal) => {
      const execution = { ...context, abortSignal };
      abortSignal?.throwIfAborted();
      await options.authorize?.(tool.tool.policy?.permissions || [], tool, execution);
      abortSignal?.throwIfAborted();
      const prerequisite = tool.tool.policy?.prerequisite;
      if (prerequisite) {
        if (!options.prerequisite) throw new Error(`No host handler for prerequisite: ${prerequisite}.`);
        await options.prerequisite(prerequisite, tool, execution);
      }
      abortSignal?.throwIfAborted();
      return invoke({ ...execution, reportProgress: context.reportProgress || (options.reportProgress ? (event) => options.reportProgress!(event, execution) : undefined) });
    };
    if (tool.tool.policy?.concurrency !== 'serial') return run();
    const group = tool.tool.policy.concurrencyGroup || tool.internalId;
    const existing = queues.get(group);
    const queue = existing || new CapabilityTaskQueue({ concurrency: 1 });
    queues.set(group, queue);
    const pending = queue.run(run, { abortSignal: context.abortSignal });
    if (!existing) {
      // One idle observer per group, including when many queued callers cancel.
      const forget = () => { void queue.idle().then(() => {
        if (queues.get(group) !== queue) return;
        const state = queue.snapshot();
        if (state.active === 0 && state.queued === 0) queues.delete(group);
        else forget();
      }); };
      forget();
    }
    return pending;
  };
}

export function disposeOnce(dispose: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | undefined;
  return () => pending ||= Promise.resolve().then(dispose);
}

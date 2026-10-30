import { createTerminalCapability } from './index.ts';
import { createNodeTerminalOperations, nodeTerminalOptions, type NodeTerminalOperations } from './node.ts';
import type { CapabilityRunContext } from '../../index.ts';

export type TerminalWorkspace = { ownerId: string; workspaceId: string };
export function createTerminalWorkspaceRegistry() {
  const entries = new Map<string, NodeTerminalOperations>();
  const key = ({ ownerId, workspaceId }: TerminalWorkspace) => {
    if (!ownerId || !workspaceId) throw new Error('A terminal workspace requires an owner and an ID.');
    return JSON.stringify([ownerId, workspaceId]);
  };
  const workspace = (context: CapabilityRunContext): TerminalWorkspace => ({
    ownerId: context.userId || '', workspaceId: context.sessionId || context.runId || '',
  });
  const get = (context: CapabilityRunContext) => {
    context.abortSignal?.throwIfAborted();
    const id = key(workspace(context));
    let manager = entries.get(id);
    if (!manager) { manager = createNodeTerminalOperations(nodeTerminalOptions(context)); entries.set(id, manager); }
    else manager.configure(nodeTerminalOptions(context));
    return manager;
  };
  return {
    get,
    capability: () => createTerminalCapability({ createOperations(context) {
      // A mounted handle never reacquires a released workspace. Only a new
      // mount/request may acquire the next workspace after explicit stop.
      let manager: NodeTerminalOperations | undefined;
      return { execute(input, execution) {
        context.abortSignal?.throwIfAborted();
        return (manager ||= get(context)).execute(input, execution);
      } };
    } }),
    async stop(scope: TerminalWorkspace) {
      const id = key(scope), manager = entries.get(id);
      if (!manager) return;
      try { await manager.dispose(); }
      finally { if (entries.get(id) === manager) entries.delete(id); }
    },
    async dispose() {
      const current = [...entries.values()]; entries.clear();
      await Promise.all(current.map(manager => manager.dispose()));
    },
  };
}

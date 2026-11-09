import { createTerminalWorkspaceRegistry } from '@cjfclonedeep/capability-sdk/execution/terminal/workspaces';
import { requireHostExecution } from '@/server/runtime/self-bootstrap-policy';

// Host composition only; lifecycle, scoped ownership and tool mounting live in the package.
const registry = createTerminalWorkspaceRegistry();
export const conversationTerminals = {
  ...registry,
  async stop(scope: Parameters<typeof registry.stop>[0]) {
    const { stopManagedSessionTools } = await import('./managed-tools');
    await Promise.all([registry.stop(scope), stopManagedSessionTools(scope.ownerId, scope.workspaceId)]);
  },
  get(context: Parameters<typeof registry.get>[0]) {
    requireHostExecution('Local terminals');
    return registry.get(context);
  },
  capability() {
    requireHostExecution('Local terminals');
    return registry.capability();
  },
};

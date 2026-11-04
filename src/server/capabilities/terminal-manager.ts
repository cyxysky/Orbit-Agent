import { createTerminalWorkspaceRegistry } from '@cjfclonedeep/capability-sdk/execution/terminal/workspaces';
import { requireSelfBootstrap } from '@/server/runtime/self-bootstrap-policy';

// Host composition only; lifecycle, scoped ownership and tool mounting live in the package.
const registry = createTerminalWorkspaceRegistry();
export const conversationTerminals = {
  ...registry,
  get(context: Parameters<typeof registry.get>[0]) {
    requireSelfBootstrap('Local terminals');
    return registry.get(context);
  },
  capability() {
    requireSelfBootstrap('Local terminals');
    return registry.capability();
  },
};

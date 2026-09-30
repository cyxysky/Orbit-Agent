import { createTerminalWorkspaceRegistry } from '@cjfclonedeep/capability-sdk/execution/terminal/workspaces';

// Host composition only; lifecycle, scoped ownership and tool mounting live in the package.
export const conversationTerminals = createTerminalWorkspaceRegistry();
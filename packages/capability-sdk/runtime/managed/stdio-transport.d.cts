import type { MCPTransport } from '@ai-sdk/mcp';
export function createStdioTransport(input: { command: string; args?: string[]; cwd?: string; env?: Record<string, string>; stderr?: 'ignore' | 'inherit'; maxMessageBytes?: number }): MCPTransport;

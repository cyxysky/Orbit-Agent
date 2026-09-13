import type { CapabilityResult, ResolvedCapabilityTool } from '../dist/index.js';
import type { McpServer, CallToolResult } from '@modelcontextprotocol/server';
export type McpVisualizationOptions = {
  enabled?: boolean;
  preview?: boolean;
  port?: number;
  readOnly?: boolean;
  staticImages?: boolean;
  loadMap?: (mapId: string, record: unknown) => Promise<unknown>;
};
export declare function createMcpVisualization(options: {
  tools: Readonly<Record<string, ResolvedCapabilityTool>>;
  invoke: (name: string, input: unknown) => Promise<CapabilityResult>;
  options?: McpVisualizationOptions;
}): Promise<undefined | {
  toolMeta(name: string): Record<string, unknown>;
  register(server: McpServer): void;
  decorate(name: string, result: CapabilityResult): Promise<Partial<CallToolResult>>;
  close(): Promise<void>;
}>;

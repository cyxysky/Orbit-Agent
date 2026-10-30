import type { McpServer, CallToolResult } from '@modelcontextprotocol/server';
import type { CapabilityResult, ResolvedCapabilityTool } from '../../index.ts';

export type McpVisualizationOptions = {
  enabled?: boolean; preview?: boolean; port?: number; readOnly?: boolean; staticImages?: boolean;
  loadMap?: (mapId: string, record: unknown) => Promise<unknown>;
};
type Visualization = {
  toolMeta(name: string): Record<string, unknown>;
  register(server: McpServer): void;
  decorate(name: string, result: CapabilityResult): Promise<Partial<CallToolResult>>;
  close(): Promise<void>;
};
type VisualizationInput = {
  tools: Readonly<Record<string, ResolvedCapabilityTool>>;
  invoke: (name: string, input: unknown) => Promise<CapabilityResult>;
  options?: McpVisualizationOptions;
};

export async function createMcpVisualization(input: VisualizationInput): Promise<Visualization | undefined> {
  // Runtime assets are shared with the standalone CLI. Keep their declaration
  // files out of source builds so an existing dist/ cannot become build input.
  const runtimeUrl = new URL('../../../scripts/mcp-ui.mjs', import.meta.url).href;
  const runtime = await import(runtimeUrl) as { createMcpVisualization: (input: VisualizationInput) => Promise<Visualization | undefined> };
  return runtime.createMcpVisualization(input);
}

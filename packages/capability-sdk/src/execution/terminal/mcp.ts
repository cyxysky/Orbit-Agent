import { createCapabilityMcpHandler, createCapabilityMcpServer, serveCapabilityMcpStdio, type CapabilityMcpServerOptions } from '../../adapters/mcp/index.ts';
import type { CapabilityProvider } from '../../index.ts';

export type TerminalMcpOptions = Omit<CapabilityMcpServerOptions, 'name' | 'version' | 'providers'> & { provider: CapabilityProvider };
const options = ({ provider, ...rest }: TerminalMcpOptions): CapabilityMcpServerOptions => ({
  ...rest, name: 'webpilot-terminal', version: '0.1.0', providers: [provider],
});
export const createTerminalMcpServer = (input: TerminalMcpOptions) => createCapabilityMcpServer(options(input));
export const createTerminalMcpHandler = (input: TerminalMcpOptions) => createCapabilityMcpHandler(options(input));
export const serveTerminalMcpStdio = (input: TerminalMcpOptions) => serveCapabilityMcpStdio(options(input));

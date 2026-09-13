import { createCapabilityMcpHandler, createCapabilityMcpServer, serveCapabilityMcpStdio, type CapabilityMcpServerOptions } from '../../adapters/mcp/index.ts';
import type { CapabilityProvider } from '../../index.ts';

export type CodeSandboxMcpOptions = Omit<CapabilityMcpServerOptions, 'name' | 'version' | 'providers'> & { provider: CapabilityProvider };
const options = (input: CodeSandboxMcpOptions): CapabilityMcpServerOptions => ({ ...input, name: 'webpilot-code-sandbox', version: '0.1.0', providers: [input.provider] });
export const createCodeSandboxMcpServer = (input: CodeSandboxMcpOptions) => createCapabilityMcpServer(options(input));
export const createCodeSandboxMcpHandler = (input: CodeSandboxMcpOptions) => createCapabilityMcpHandler(options(input));
export const serveCodeSandboxMcpStdio = (input: CodeSandboxMcpOptions) => serveCapabilityMcpStdio(options(input));

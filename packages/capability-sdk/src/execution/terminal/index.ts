import { z } from 'zod';
import {
  createCapabilityRuntime, defineCapabilityInput, defineCapabilityTool,
  type CapabilityExecutionContext, type CapabilityHealth, type CapabilityManifest,
  type CapabilityProvider, type CapabilityRunContext,
} from '../../index.ts';
import { terminalRuntimeSkill } from './runtime-skill.ts';
import { terminalCapabilitySettings } from './settings.ts';
export * from './runtime-skill.ts';
export * from './settings.ts';

export const terminalCapabilityToolNames = Object.freeze({ terminal: 'terminal' } as const);
const reason = z.string().trim().min(1).max(300);
const sessionId = z.string().trim().min(1).max(100);
const yieldMs = z.number().int().min(0).max(10000).optional();
const stdin = z.string().max(100000);
const parser = z.discriminatedUnion('action', [
  z.object({ action: z.literal('run'), reason, command: z.string().trim().min(1).max(100000), cwd: z.string().trim().min(1).max(4000).optional(), stdin: stdin.optional(), keepStdinOpen: z.boolean().optional(), timeoutMs: z.number().int().min(1).max(3600000).optional(), yieldMs }).strict(),
  z.object({ action: z.literal('read'), reason, sessionId, yieldMs }).strict(),
  z.object({ action: z.literal('write'), reason, sessionId, stdin, closeStdin: z.boolean().optional(), yieldMs }).strict(),
  z.object({ action: z.literal('stop'), reason, sessionId }).strict(),
]);
export type TerminalToolInput = z.infer<typeof parser>;
export type TerminalStatus = 'running' | 'exited' | 'failed' | 'timed_out' | 'cancelled';
export type TerminalResult = {
  sessionId: string; shell: string; cwd: string; status: TerminalStatus;
  exitCode: number | null; signal: string | null;
  stdout: string; stderr: string; truncated: boolean; error?: string;
};
export interface TerminalOperations {
  execute(input: TerminalToolInput, context: CapabilityExecutionContext): Promise<TerminalResult>;
  health?(): Promise<CapabilityHealth>;
  dispose?(): Promise<void>;
}
export const terminalToolInput = defineCapabilityInput<TerminalToolInput>(
  z.toJSONSchema(parser) as Readonly<Record<string, unknown>>, value => parser.parse(value),
);
export const terminalCapabilityManifest = Object.freeze({
  schemaVersion: 1, id: 'com.webpilot.terminal', name: 'Local Terminal', version: '0.1.0',
  description: 'Run local shell commands and manage their process sessions on the host machine.',
  permissions: ['process:terminal'], runtimeRequirements: { node: '>=22.16', shell: true },
  configuration: { settings: terminalCapabilitySettings }, skills: [terminalRuntimeSkill],
} satisfies CapabilityManifest);

export function createTerminalTool(operations: TerminalOperations, configuration: CapabilityRunContext['configuration']) {
  return defineCapabilityTool<TerminalToolInput, TerminalResult>({
    name: 'terminal',
    description: 'Run commands on the host machine using its configured shell. Read incremental process output, write stdin or stop a process using its returned sessionId. This is not a sandbox.',
    input: terminalToolInput,
    policy: { concurrency: 'serial', concurrencyGroup: 'local-terminal', permissions: terminalCapabilityManifest.permissions },
    async execute(input, context) {
      if (configuration.AGENT_TERMINAL_ENABLED !== 'true') {
        return { ok: false, error: { code: 'terminal-disabled', message: 'Local terminal is disabled in host settings.' } };
      }
      try {
        const data = await operations.execute(input, context);
        context.abortSignal?.throwIfAborted();
        if (data.status !== 'running' && data.status !== 'exited') {
          return { ok: false, error: {
            code: `terminal-${data.status}`,
            message: data.error || `Command exited with code ${data.exitCode}.`,
            details: data,
          } };
        }
        return { ok: true, summary: `Terminal ${data.status}${data.exitCode === null ? '' : ` (exit ${data.exitCode})`}.`, data };
      } catch (error) {
        context.abortSignal?.throwIfAborted();
        return { ok: false, error: { code: 'terminal-operation-failed', message: error instanceof Error ? error.message : String(error) } };
      }
    },
  });
}

export function createTerminalCapability(options: { createOperations(context: CapabilityRunContext): TerminalOperations | Promise<TerminalOperations> }): CapabilityProvider {
  return {
    manifest: terminalCapabilityManifest,
    async createRuntime(context) {
      const operations = await options.createOperations(context);
      return createCapabilityRuntime({
        tools: { terminal: createTerminalTool(operations, context.configuration) },
        health: () => context.configuration.AGENT_TERMINAL_ENABLED === 'true'
          ? operations.health?.() || Promise.resolve({ status: 'healthy' })
          : Promise.resolve({ status: 'degraded', message: 'Local terminal is disabled.' }),
        dispose: () => operations.dispose?.() || Promise.resolve(),
      });
    },
  };
}

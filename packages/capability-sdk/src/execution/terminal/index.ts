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
const terminalId = z.string().trim().min(1).max(100);
const name = z.string().trim().min(1).max(100);
const cursor = z.number().int().min(0).optional();
const yieldMs = z.number().int().min(0).max(30000).optional()
  .describe('Maximum wait for this call. The terminal and its command continue after this call returns.');
const dimensions = { cols: z.number().int().min(20).max(500), rows: z.number().int().min(5).max(200) };
const parser = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), reason, name: name.optional(), cwd: z.string().trim().min(1).max(4000).optional(), cols: dimensions.cols.optional(), rows: dimensions.rows.optional() }).strict(),
  z.object({ action: z.literal('list'), reason }).strict(),
  z.object({ action: z.literal('run'), reason, terminalId, command: z.string().trim().min(1).max(100000),
    timeoutMs: z.number().int().min(0).max(3600000).optional().describe('Command timeout; 0 means no deadline. Timeout interrupts the foreground command.'),
    yieldMs }).strict(),
  z.object({ action: z.literal('read'), reason, terminalId, cursor }).strict(),
  z.object({ action: z.literal('wait'), reason, terminalId, cursor, yieldMs }).strict(),
  z.object({ action: z.literal('write'), reason, terminalId, input: z.string().min(1).max(100000) }).strict(),
  z.object({ action: z.literal('interrupt'), reason, terminalId }).strict(),
  z.object({ action: z.literal('resize'), reason, terminalId, ...dimensions }).strict(),
  z.object({ action: z.literal('rename'), reason, terminalId, name }).strict(),
  z.object({ action: z.literal('close'), reason, terminalId }).strict(),
  z.object({ action: z.literal('delete'), reason, terminalId }).strict(),
]);
export type TerminalToolInput = z.infer<typeof parser>;
export type TerminalCommand = {
  id: string; command: string; startedAt: string; completedAt?: string;
  status: 'running' | 'succeeded' | 'failed' | 'interrupted' | 'timed_out';
  exitCode: number | null; timeoutMs: number;
};
export type TerminalSummary = {
  terminalId: string; name: string; shell: string; cwd: string; pid: number;
  status: 'starting' | 'ready' | 'running' | 'closed';
  createdAt: string; cols: number; rows: number; exitCode: number | null;
  command?: TerminalCommand; cursor: number; startCursor: number;
};
export type TerminalResult = {
  terminals?: TerminalSummary[]; terminal?: TerminalSummary;
  output?: string; cursor?: number; truncated?: boolean; deleted?: string;
};
export type TerminalEvent =
  | { type: 'reset' }
  | { type: 'output'; terminalId: string; output: string; startCursor: number; cursor: number }
  | { type: 'state'; terminal: TerminalSummary }
  | { type: 'deleted'; terminalId: string };
export interface TerminalOperations {
  execute(input: TerminalToolInput, context: CapabilityExecutionContext): Promise<TerminalResult>;
  health?(): Promise<CapabilityHealth>;
  dispose?(): Promise<void>;
}
export const terminalToolInput = defineCapabilityInput<TerminalToolInput>(
  z.toJSONSchema(parser) as Readonly<Record<string, unknown>>, value => parser.parse(value),
);
export const terminalCapabilityManifest = Object.freeze({
  schemaVersion: 1, id: 'com.webpilot.terminal', name: 'Local Terminal', version: '0.2.0',
  description: 'Create and manage reusable PTY terminals with live output and persistent shell state.',
  permissions: ['process:terminal'], runtimeRequirements: { node: '>=22.16', shell: true, pty: true },
  configuration: { settings: terminalCapabilitySettings }, skills: [terminalRuntimeSkill],
} satisfies CapabilityManifest);

export function createTerminalTool(operations: TerminalOperations, configuration: CapabilityRunContext['configuration']) {
  return defineCapabilityTool<TerminalToolInput, TerminalResult>({
    name: 'terminal',
    description: 'Manage persistent PTY terminals: list/create, run multiple commands in the same terminalId, read/wait using a cursor, write interactive input, interrupt (Ctrl+C), resize, rename, close or delete. Working directory and environment persist. Output streams live; a running command survives tool calls. Run commands directly without Start-Process or log-file polling.',
    input: terminalToolInput,
    policy: { concurrency: 'parallel', permissions: terminalCapabilityManifest.permissions },
    async execute(input, context) {
      if (configuration.AGENT_TERMINAL_ENABLED !== 'true') {
        return { ok: false, error: { code: 'terminal-disabled', message: 'Local terminal is disabled in host settings.' } };
      }
      try {
        const data = await operations.execute(input, context);
        const command = data.terminal?.command;
        if ((input.action === 'run' || input.action === 'wait') && command && ['failed', 'timed_out', 'interrupted'].includes(command.status)) {
          return { ok: false, error: { code: `terminal-${command.status}`,
            message: `Command ${command.status} (exit ${command.exitCode ?? 'unknown'}). See terminal state in details.`, details: data } };
        }
        return { ok: true, summary: data.terminal ? `Terminal ${data.terminal.name}: ${data.terminal.status}.` : 'Terminal management completed.', data };
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

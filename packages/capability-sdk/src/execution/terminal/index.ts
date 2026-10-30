import { z } from 'zod';
import {
  createCapabilityRuntime, defineCapabilityInput, defineCapabilityTool,
  type CapabilityExecutionContext, type CapabilityHealth, type CapabilityManifest,
  type CapabilityProvider, type CapabilityRunContext,
} from '../../index.ts';
import { terminalRuntimeSkill } from './runtime-skill.ts';
import { terminalCapabilitySettings } from './settings.ts';
import type { TerminalGeometry } from './geometry.ts';
export type { TerminalOutputOptions } from './output.ts';
export * from './runtime-skill.ts';
export * from './settings.ts';
export * from './geometry.ts';

export const terminalCapabilityToolNames = Object.freeze({ terminal: 'terminal' } as const);
const reason = z.string().trim().min(1).max(300);
const terminalId = z.string().trim().min(1).max(100);
const name = z.string().trim().min(1).max(100);
const cursor = z.number().int().min(0).optional();
const yieldMs = z.number().int().min(0).max(30000).optional()
  .describe('Maximum wait for this call. The terminal and its command continue after this call returns.');
const dimensions = { cols: z.number().int().min(20).max(500), rows: z.number().int().min(5).max(200) };
const outputOptions = {
  maxOutputChars: z.number().int().min(2).max(200000).optional().describe('Returned text budget in UTF-16 code units; default 8000. Does not change retained history.'),
  outputMode: z.enum(['head', 'tail']).optional().describe('head (default) pages forward using cursor; tail skips older text and reports omittedChars.'),
};
const commandOptions = {
  command: z.string().trim().min(1).max(100000),
  timeoutMs: z.number().int().min(0).max(3600000).optional().describe('Command deadline; 0 means none. Independent of yieldMs.'),
  yieldMs, ...outputOptions,
};
const cwd = z.string().trim().min(1).max(4000).optional();
const shell = z.enum(['powershell', 'pwsh', 'bash']).optional();
const detail = z.boolean().optional().describe('Include full terminal metadata; default compact. Output remains budgeted.');
const parser = z.discriminatedUnion('action', [
  z.object({ action: z.literal('exec'), reason, detail, cwd, shell, ...commandOptions }).strict(),
  z.object({ action: z.literal('create'), reason, detail, shell, name: name.optional(), cwd, cols: dimensions.cols.optional(), rows: dimensions.rows.optional() }).strict(),
  z.object({ action: z.literal('list'), reason, detail }).strict(),
  z.object({ action: z.literal('run'), reason, detail, terminalId, ...commandOptions }).strict(),
  z.object({ action: z.literal('read'), reason, detail, terminalId, cursor, commandId: terminalId.optional(), ...outputOptions }).strict(),
  z.object({ action: z.literal('wait'), reason, detail, terminalId, cursor, commandId: terminalId.optional(), yieldMs, ...outputOptions }).strict(),
  z.object({ action: z.literal('write'), reason, detail, terminalId, input: z.string().min(1).max(100000) }).strict(),
  z.object({ action: z.literal('interrupt'), reason, detail, terminalId }).strict(),
  z.object({ action: z.literal('resize'), reason, detail, terminalId, ...dimensions }).strict(),
  z.object({ action: z.literal('rename'), reason, detail, terminalId, name }).strict(),
  z.object({ action: z.literal('close'), reason, detail, terminalId }).strict(),
  z.object({ action: z.literal('delete'), reason, detail, terminalId }).strict(),
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
  transport: 'pty' | 'pipe';
  windowsPty?: { backend: 'conpty' | 'winpty'; buildNumber?: number };
};
export type TerminalResult = {
  terminals?: TerminalSummary[]; terminal?: TerminalSummary;
  output?: string; outputGeometry?: TerminalGeometry; cursor?: number; truncated?: boolean; deleted?: string;
  outputStartCursor?: number; endCursor?: number; hasMore?: boolean; omittedChars?: number; released?: boolean;
};
export type CompactTerminal = Pick<TerminalSummary, 'terminalId' | 'shell' | 'cwd' | 'status' | 'transport'> & { name?: string };
export type CompactTerminalResult = Omit<TerminalResult, 'terminal' | 'terminals'> & {
  terminals?: CompactTerminal[]; terminalId?: string; shell?: string; cwd?: string; transport?: 'pty' | 'pipe';
  status?: TerminalCommand['status'] | TerminalSummary['status']; commandId?: string; exitCode?: number | null;
};
function compactResult(data: TerminalResult): CompactTerminalResult {
  const { terminal, terminals, released, ...output } = data;
  return { ...output,
    ...(terminal ? { ...(!released ? { terminalId: terminal.terminalId } : {}), shell: terminal.shell, cwd: terminal.cwd, transport: terminal.transport,
      status: terminal.command?.status ?? terminal.status, ...(terminal.command ? { commandId: terminal.command.id, exitCode: terminal.command.exitCode } : {}) } : {}),
    ...(terminals ? { terminals: terminals.map(t => ({ terminalId: t.terminalId, name: t.name, shell: t.shell, cwd: t.cwd, status: t.status, transport: t.transport })) } : {}),
  };
}
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
  return defineCapabilityTool<TerminalToolInput, TerminalResult | CompactTerminalResult>({
    name: 'terminal',
    description: 'exec runs a command directly in a fresh noninteractive shell; cwd and shell are optional. Long commands return terminalId for read/wait/interrupt. create/run provides a reusable interactive PTY. maxOutputChars budgets each response; head pages with cursor, tail reports skipped text. Results are compact by default; detail includes terminal metadata.',
    resultText: 'summary',
    input: terminalToolInput,
    policy: { concurrency: 'parallel', permissions: terminalCapabilityManifest.permissions },
    async execute(input, context) {
      if (configuration.AGENT_TERMINAL_ENABLED !== 'true') {
        return { ok: false, error: { code: 'terminal-disabled', message: 'Local terminal is disabled in host settings.' } };
      }
      try {
        const result = await operations.execute(input, context);
        const command = result.terminal?.command;
        const data = input.detail ? result : compactResult(result);
        const summary = command ? `${command.status}${command.exitCode === null ? '' : ` (exit ${command.exitCode})`}` : 'Terminal operation completed.';
        if (['exec', 'run', 'read', 'wait'].includes(input.action) && command && ['failed', 'timed_out', 'interrupted'].includes(command.status)) {
          return { ok: false, summary, data, error: { code: `terminal-${command.status}`, message: summary } };
        }
        return { ok: true, summary, data };
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

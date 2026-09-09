import { z } from 'zod';
import {
  defineCapabilityInput,
  defineCapabilityTool,
  normalizeBoundedInteger,
  type CapabilityExecutionContext,
  type CapabilityHealth,
  type CapabilityManifest,
  type CapabilityProvider,
  type CapabilityResult,
  type CapabilityRunContext,
} from '@webpilot/capability-sdk';
import { codeSandboxRuntimeSkill, codeSandboxRuntimeSkillId } from './runtime-skill.ts';
import { codeSandboxCapabilitySettings } from './settings.ts';
export * from './runtime-skill.ts';
export * from './settings.ts';

export const codeSandboxCapabilityToolNames = Object.freeze({ codeSandbox: 'codeSandbox' } as const);
export type CodeSandboxLanguage = 'javascript' | 'python';
export type CodeSandboxNetworkMode = 'full' | 'none';
export type CodeSandboxTransportFile = { path: string; size?: number; base64: string };
export type CodeSandboxArtifact = { artifactId: string; fileName: string; size: number; mediaType: string; url: string; downloadUrl: string };
export type CodeSandboxReadResult = CodeSandboxArtifact & { encoding: 'utf8' | 'base64'; content: string; offset: number; nextOffset?: number; totalBytes: number; imagePath?: string };
export type CodeSandboxExecution = {
  language: CodeSandboxLanguage;
  code: string;
  args: string[];
  packages: string[];
  networkMode: CodeSandboxNetworkMode;
  timeoutMs: number;
  installTimeoutMs: number;
  maxOutputChars: number;
  memoryLimitMb: number;
  cpuLimit: number;
  pidsLimit: number;
  workspaceLimitMb: number;
  outputFiles?: string[];
  inputFiles?: CodeSandboxTransportFile[];
  artifactInputs?: Array<{ artifactId: string; path: string }>;
};
export type CodeSandboxExecutionResult = {
  exitCode: number | null;
  signal?: string;
  stdout: string;
  stderr: string;
  truncated: boolean;
  elapsedMs: number;
  timedOut?: boolean;
  aborted?: boolean;
  outputLimitExceeded?: boolean;
  packagesInstalled?: string[];
  installElapsedMs?: number;
  /** Internal runner transport only; consuming hosts must persist and remove this field. */
  files?: CodeSandboxTransportFile[];
  artifacts?: CodeSandboxArtifact[];
};
export interface CodeSandboxExecutor {
  run(input: CodeSandboxExecution, context: CapabilityExecutionContext): Promise<CodeSandboxExecutionResult>;
  readFile?(input: { artifactId: string; offset?: number; limit?: number; encoding?: 'utf8' | 'base64' }, context: CapabilityExecutionContext): Promise<CodeSandboxReadResult>;
  health?(): Promise<CapabilityHealth>;
  dispose?(): Promise<void>;
}

export class CodeSandboxRunnerError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CodeSandboxRunnerError';
  }
}

const runParser = z.object({
  action: z.literal('run'),
  reason: z.string().trim().min(1).max(300),
  language: z.enum(['javascript', 'python']),
  code: z.string().min(1).max(100_000),
  args: z.array(z.string().max(2_000)).max(32).optional(),
  packages: z.array(z.string().trim().min(1).max(200)).max(32).optional(),
  outputFiles: z.array(z.string().min(1).max(500)).max(16).optional().describe('Additional relative files to save. Files under outputs/ are saved automatically, separately from stdout.'),
  inputFiles: z.array(z.object({ artifactId: z.string().min(1).max(1000), path: z.string().min(1).max(500) }).strict()).max(16).optional().describe('Mount previously saved sandbox artifacts under inputs/, e.g. {artifactId, path:"inputs/chart.png"}.'),
  timeoutMs: z.number().int().min(1_000).max(300_000).optional(),
  maxOutputChars: z.union([
    z.number(),
    z.string().regex(/^\d+$/).transform(Number),
  ]).pipe(z.number().int().min(1_000).max(200_000)).optional()
    .describe('Combined stdout/stderr character budget (1000..200000); use a JSON number. Clamped to the host output limit. Excess output is truncated, not a file transfer channel.'),
}).strict();
const parser = z.discriminatedUnion('action', [runParser, z.object({
  action: z.literal('readFile'),
  reason: z.string().trim().min(1).max(300),
  artifactId: z.string().min(1).max(1000),
  offset: z.number().int().min(0).optional().describe('Byte offset from the previous nextOffset.'),
  limit: z.number().int().min(1).max(24000).optional(),
  encoding: z.enum(['utf8', 'base64']).optional(),
}).strict()]);
export type CodeSandboxToolInput = z.infer<typeof parser>;
export const codeSandboxToolInput = defineCapabilityInput<CodeSandboxToolInput>(
  z.toJSONSchema(parser, { io: 'input' }) as Readonly<Record<string, unknown>>,
  (value) => parser.parse(value),
);

const npmPackageSpec = /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const pythonPackageSpec = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\[[A-Za-z0-9_,.-]+\])?==\d+(?:\.\d+)+(?:[A-Za-z0-9.+-]*)$/;

export function invalidCodeSandboxPackageSpecs(language: CodeSandboxLanguage, packages: readonly string[]) {
  const pattern = language === 'javascript' ? npmPackageSpec : pythonPackageSpec;
  return packages.filter((item) => !pattern.test(item.trim()));
}

export const codeSandboxCapabilityManifest = Object.freeze({
  schemaVersion: 1,
  id: 'com.webpilot.code-sandbox',
  name: 'Code Sandbox',
  version: '0.1.0',
  description: 'Run bounded JavaScript and Python computations in a host-selected execution backend.',
  permissions: ['process:execute', 'workspace:temporary', 'network:egress', 'package:install', 'artifact:read', 'artifact:write'],
  runtimeRequirements: { node: '>=22.16', python: '3.x', backend: 'remote-recommended' },
  configuration: { settings: codeSandboxCapabilitySettings },
  skills: [codeSandboxRuntimeSkill],
} satisfies CapabilityManifest);

export function createCodeSandboxTool(executor: CodeSandboxExecutor, configuration: CapabilityRunContext['configuration']) {
  return defineCapabilityTool<CodeSandboxToolInput, CodeSandboxExecutionResult | CodeSandboxReadResult>({
    name: codeSandboxCapabilityToolNames.codeSandbox,
    description: `Run JavaScript (Node.js ESM .mjs; use import) or Python. Files written under outputs/ or listed in outputFiles are saved as persistent artifacts with URLs. readFile reads saved content; inputFiles mounts saved artifacts for subsequent code. Read Skill ${codeSandboxRuntimeSkillId} before use. Keep stdout compact; files use a separate export channel.`,
    input: codeSandboxToolInput,
    policy: { concurrency: 'parallel', concurrencyGroup: 'code-sandbox', permissions: codeSandboxCapabilityManifest.permissions },
    async execute(input, context): Promise<CapabilityResult<CodeSandboxExecutionResult | CodeSandboxReadResult>> {
      if (configuration.AGENT_CODE_SANDBOX_ENABLED !== 'true') {
        return { ok: false, error: { code: 'code-sandbox-disabled', message: 'Code Sandbox is disabled by host configuration.' } };
      }
      if (input.action === 'readFile') {
        try {
          if (!executor.readFile) throw new Error('This host does not provide persistent sandbox file storage.');
          const { imagePath, ...data } = await executor.readFile(input, context);
          return { ok: true, summary: `Read ${data.fileName}${data.nextOffset === undefined ? '.' : '; more bytes are available at nextOffset.'}`, data,
            content: imagePath ? [{ type: 'image', artifactId: imagePath, mediaType: data.mediaType }] : [] };
        } catch (error) {
          return { ok: false, error: { code: 'code-file-read-failed', message: error instanceof Error ? error.message : String(error) } };
        }
      }
      const packages = (input.packages || []).map((item) => item.trim());
      const invalidPackages = invalidCodeSandboxPackageSpecs(input.language, packages);
      if (invalidPackages.length) {
        return {
          ok: false,
          error: {
            code: 'code-package-spec-invalid',
            message: `Only exact package versions are allowed. Invalid ${input.language} package spec(s): ${invalidPackages.join(', ')}`,
          },
        };
      }
      const maxPackages = normalizeBoundedInteger(configuration.AGENT_CODE_SANDBOX_MAX_PACKAGES, 16, 0, 32);
      if (packages.length > maxPackages) {
        return { ok: false, error: { code: 'code-package-limit', message: `At most ${maxPackages} package(s) may be installed per execution.` } };
      }
      if (packages.length && configuration.AGENT_CODE_SANDBOX_ALLOW_PACKAGE_INSTALL !== 'true') {
        return { ok: false, error: { code: 'code-package-install-disabled', message: 'Package installation is disabled by host configuration.' } };
      }
      const configuredTimeoutMs = normalizeBoundedInteger(configuration.AGENT_CODE_SANDBOX_TIMEOUT_MS, 30_000, 1_000, 300_000);
      const configuredMaxOutputChars = normalizeBoundedInteger(configuration.AGENT_CODE_SANDBOX_MAX_OUTPUT_CHARS, 30_000, 1_000, 200_000);
      const maxOutputChars = Math.min(input.maxOutputChars ?? configuredMaxOutputChars, configuredMaxOutputChars);
      try {
        const result = await executor.run({
          language: input.language,
          code: input.code,
          args: input.args || [],
          packages,
          outputFiles: input.outputFiles,
          artifactInputs: input.inputFiles,
          networkMode: configuration.AGENT_CODE_SANDBOX_NETWORK_MODE === 'none' ? 'none' : 'full',
          timeoutMs: Math.min(input.timeoutMs ?? configuredTimeoutMs, configuredTimeoutMs),
          installTimeoutMs: normalizeBoundedInteger(configuration.AGENT_CODE_SANDBOX_INSTALL_TIMEOUT_MS, 120_000, 5_000, 300_000),
          maxOutputChars,
          memoryLimitMb: normalizeBoundedInteger(configuration.AGENT_CODE_SANDBOX_MEMORY_MB, 512, 64, 4096),
          cpuLimit: Math.min(4, Math.max(0.1, Number(configuration.AGENT_CODE_SANDBOX_CPU_LIMIT) || 1)),
          pidsLimit: normalizeBoundedInteger(configuration.AGENT_CODE_SANDBOX_PIDS_LIMIT, 128, 16, 512),
          workspaceLimitMb: normalizeBoundedInteger(configuration.AGENT_CODE_SANDBOX_WORKSPACE_MB, 256, 32, 4096),
        }, context);
        if (result.files?.length) throw new Error('The host must persist sandbox output files before returning them to the model.');
        delete result.files;
        const outputWarning = result.truncated || result.outputLimitExceeded
          ? `Output was truncated at ${maxOutputChars} combined stdout/stderr characters. Captured stdout/stderr is incomplete; saved artifacts are unaffected. Read saved files with readFile or mount them with inputFiles. maxOutputChars cannot exceed the host setting AGENT_CODE_SANDBOX_MAX_OUTPUT_CHARS.`
          : '';
        return result.exitCode === 0 && !result.timedOut && !result.aborted
          ? { ok: true, summary: [`${input.language} computation completed.`, outputWarning].filter(Boolean).join(' '), data: result,
              content: result.artifacts?.map(artifact => ({ type: 'artifact' as const, artifactId: artifact.artifactId, downloadUrl: artifact.downloadUrl, mediaType: artifact.mediaType })) }
          : {
            ok: false,
            summary: `${input.language} computation failed.`,
            error: {
              code: 'code-execution-failed',
              message: [
                result.timedOut
                  ? 'Process timed out.'
                  : result.aborted
                    ? 'Process was aborted.'
                    : result.exitCode === null
                        ? `Process terminated${result.signal ? ` by signal ${result.signal}` : ' without an exit code'}.`
                        : `Process exited with code ${result.exitCode}.`,
                result.stderr.trim(),
                input.language === 'javascript' && /require is not defined in ES module scope/.test(result.stderr)
                  ? "JavaScript runs as Node.js ESM (.mjs). Use import sharp from 'sharp'; or explicitly create require with import { createRequire } from 'node:module'; const require = createRequire(import.meta.url). This is an execution error, not a dependency installation error."
                  : '',
                outputWarning,
                result.artifacts?.length ? `Files saved before failure: ${JSON.stringify(result.artifacts)}` : '',
              ].filter(Boolean).join('\n'),
              details: result,
            },
          };
      } catch (error) {
        return { ok: false, error: { code: error instanceof CodeSandboxRunnerError ? error.code : 'code-execution-error', message: error instanceof Error ? error.message : String(error), retryable: false } };
      }
    },
  });
}

export function createCodeSandboxCapability(options: { createExecutor(context: CapabilityRunContext): CodeSandboxExecutor | Promise<CodeSandboxExecutor> }): CapabilityProvider {
  return {
    manifest: codeSandboxCapabilityManifest,
    async createRuntime(context) {
      const executor = await options.createExecutor(context);
      return {
        tools: Object.freeze({ [codeSandboxCapabilityToolNames.codeSandbox]: createCodeSandboxTool(executor, context.configuration) }),
        health: () => executor.health?.() || Promise.resolve({ status: context.configuration.AGENT_CODE_SANDBOX_ENABLED === 'true' ? 'healthy' : 'degraded', message: context.configuration.AGENT_CODE_SANDBOX_ENABLED === 'true' ? undefined : 'Disabled by configuration.' }),
        dispose: () => executor.dispose?.() || Promise.resolve(),
      };
    },
  };
}

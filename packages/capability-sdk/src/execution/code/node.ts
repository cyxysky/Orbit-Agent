import { readManagedRuntime } from '../../runtime.ts';
import { createCodeSandboxCapability, type CodeSandboxExecutor } from './index.ts';
import type { CapabilityRunContext } from '../../index.ts';
import { createCodeExecutionEngine } from '../../../runtime/execution/engine.cjs';

type LocalProcessOptions = {
  workspaceDirectory: string;
  nodeExecutable?: string;
  pythonExecutable?: string;
  npmExecutable?: string;
};

export function createNodeProcessCodeSandbox(input: LocalProcessOptions & { maxConcurrent?: number }): CodeSandboxExecutor {
  const engine = createCodeExecutionEngine({...input, pythonExecutable: input.pythonExecutable || readManagedRuntime()?.python});
  return {
    run: (execution, context) => engine.run(execution, context.abortSignal),
    health: () => engine.health(),
    dispose: () => engine.dispose(),
  };
}

export function createNodeCodeSandboxCapability(input: {
  workspaceDirectory: string | ((context: CapabilityRunContext) => string);
  nodeExecutable?: string;
  pythonExecutable?: string;
  npmExecutable?: string;
  maxConcurrent?: number;
}) {
  return createCodeSandboxCapability({
    createExecutor(context) {
      return createNodeProcessCodeSandbox({
        workspaceDirectory: typeof input.workspaceDirectory === 'function' ? input.workspaceDirectory(context) : input.workspaceDirectory,
        nodeExecutable: input.nodeExecutable,
        pythonExecutable: input.pythonExecutable,
        npmExecutable: input.npmExecutable,
        maxConcurrent: input.maxConcurrent,
      });
    },
  });
}

type TransportFile = {path:string; size?:number; base64:string};
type CodeSandboxExecution = {language:'javascript'|'python'; code:string; args:string[]; packages:string[];
  networkMode:'full'|'none'; timeoutMs:number; installTimeoutMs:number; maxOutputChars:number;
  inputFiles?:TransportFile[]; outputFiles?:string[]};
type CodeSandboxExecutionResult = {exitCode:number|null; signal?:string; stdout:string; stderr:string;
  truncated:boolean; elapsedMs:number; timedOut?:boolean; aborted?:boolean; outputLimitExceeded?:boolean;
  packagesInstalled?:string[]; installElapsedMs?:number; files?:TransportFile[]};
type CapabilityHealth = {status:'healthy'|'needs-runtime'|'unhealthy'; message?:string};
export function createCodeExecutionEngine(options: {
  workspaceDirectory: string;
  nodeExecutable?: string;
  pythonExecutable?: string;
  npmExecutable?: string;
  npmCli?: string;
  pipCacheDirectory?: string;
  maxConcurrent?: number;
  dropPrivileges?: boolean;
}): {
  run(payload: CodeSandboxExecution, signal?: AbortSignal): Promise<CodeSandboxExecutionResult>;
  health(): Promise<CapabilityHealth>;
  dispose(): Promise<void>;
};

export interface TerminalProcess {
  pid: number;
  write(input: string): void;
  resize(cols: number, rows: number): Promise<void>;
  kill(): void;
  onData(listener: (output: string) => void): { dispose(): void };
  onResize(listener: (event: { cols: number; rows: number }) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number }) => void): { dispose(): void };
}
export function spawnTerminal(executable: string, args: string[], options: {
  cwd: string; cols: number; rows: number; name: string; env: Record<string, string>;
}): Promise<TerminalProcess>;

import type { ChildProcess } from 'node:child_process';
export function stopProcessTree(child: ChildProcess | undefined, options?: { force?: boolean }): Promise<void>;

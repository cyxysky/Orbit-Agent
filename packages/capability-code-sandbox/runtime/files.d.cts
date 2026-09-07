type TransportFile = { path: string; size?: number; base64: string };
export function collectFiles(directory: string, requested?: string[]): Promise<TransportFile[]>;
export function stageFiles(directory: string, files?: TransportFile[]): Promise<void>;
export function decodeFile(file: TransportFile): Buffer;
export function relativeFile(value: string): string;
export const MAX_TOTAL_BYTES: number;

export type ManagedRuntime = {
  format: 2;
  platform: string;
  arch: string;
  status: 'ready';
  fingerprint: string;
  python: string;
  libreoffice: string;
  unoPython: string;
  chromium: string;
  ffmpeg: string;
  models: { gliner: string; chinese: string; pii: string };
};
export function runtimeDirectory(environment?: Readonly<Record<string, string | undefined>>): string;
export function readManagedRuntime(environment?: Readonly<Record<string, string | undefined>>): ManagedRuntime | undefined;
export function managedModelDirectory(key: 'gliner' | 'chinese' | 'pii', requested?: string, environment?: Readonly<Record<string, string | undefined>>): string;

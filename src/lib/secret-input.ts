/** Only reveal a small identifier for long keys; short secrets remain fully masked. */
export function maskSecret(value: string) {
  if (!value) return '';
  return value.length > 16 ? `${value.slice(0, 6)}${'•'.repeat(12)}${value.slice(-4)}` : '•'.repeat(12);
}

export type SettingsSecretSource =
  | { kind: 'provider'; provider: string }
  | { kind: 'environment'; key: string }
  | { kind: 'integration'; id: string; field: string };

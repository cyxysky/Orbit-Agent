import path from 'node:path';
import { createSensitiveDataRuntimeInstaller } from '@cjfclonedeep/capability-sdk/sensitive-data/node';
import { appDataRoot } from '@/server/storage/paths';

export function sensitiveDataRuntimeDirectory() {
  const directory = process.env.CAPABILITY_SENSITIVE_DATA_RUNTIME_HOME || path.join(appDataRoot(), 'sensitive-data', `${process.platform}-${process.arch}`);
  process.env.CAPABILITY_SENSITIVE_DATA_RUNTIME_HOME = directory;
  return directory;
}
export function sensitiveDataRuntimeInstaller() {
  return createSensitiveDataRuntimeInstaller({ directory: sensitiveDataRuntimeDirectory() });
}

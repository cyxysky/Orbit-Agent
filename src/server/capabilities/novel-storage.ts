import path from 'node:path';
import { normalizeApplicationUserId } from '@/server/auth/user-context';
import { appDataRoot } from '@/server/storage/paths';

/** Keep existing user directories, without stripping valid characters into another user's id. */
export function novelUserDirectory(userId?: string) {
  const id = normalizeApplicationUserId(userId);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id)) throw new Error('Invalid novel owner.');
  return path.join(appDataRoot(), 'novels', id);
}

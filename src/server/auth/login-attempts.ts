const attempts = new Map<string, { failed: number; expiresAt: number }>();
const windowMs = 15 * 60 * 1000;
const limit = 5;

export function loginAttemptKey(request: Request) { return request.headers.get('x-webpilot-client-address') || 'local'; }
export function loginRetryAfter(key: string) {
  const current = attempts.get(key);
  if (!current || current.expiresAt <= Date.now()) { attempts.delete(key); return 0; }
  return current.failed >= limit ? Math.ceil((current.expiresAt - Date.now()) / 1000) : 0;
}
export function recordLoginAttempt(key: string, successful: boolean) {
  if (successful) { attempts.delete(key); return; }
  if (attempts.size >= 1000) {
    for (const [oldKey, value] of attempts) if (value.expiresAt <= Date.now()) attempts.delete(oldKey);
    if (attempts.size >= 1000) attempts.delete(attempts.keys().next().value!);
  }
  const previous = attempts.get(key);
  attempts.set(key, { failed: (previous && previous.expiresAt > Date.now() ? previous.failed : 0) + 1,
    expiresAt: previous && previous.expiresAt > Date.now() ? previous.expiresAt : Date.now() + windowMs });
}

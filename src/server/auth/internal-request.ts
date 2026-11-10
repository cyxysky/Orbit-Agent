/** Private, read-only renderer requests. Never expose these headers to browser clients or external origins. */
export function internalReadHeaders(userId: string) {
  const token = process.env.WEBPILOT_INTERNAL_REQUEST_TOKEN;
  if (!token || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(userId)) throw new Error('Internal request identity is not configured.');
  return { 'x-webpilot-internal-token': token, 'x-webpilot-internal-user-id': userId, 'x-webpilot-internal-purpose': 'render' };
}

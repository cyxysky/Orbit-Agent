import { revokeAdminSession, clearAuthenticationCookies, authenticationResponse, rejectCrossOriginAuthentication } from '@/server/auth/admin-session';

export async function POST(request: Request) {
  const denied = rejectCrossOriginAuthentication(request);
  if (denied) return denied;
  await revokeAdminSession(request);
  const response = authenticationResponse({ ok: true });
  for (const cookie of clearAuthenticationCookies(request)) response.headers.append('Set-Cookie', cookie);
  return response;
}

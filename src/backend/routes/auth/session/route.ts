import { readAdminSession, authenticationResponse } from '@/server/auth/admin-session';
import { administratorLoginEnabled, administratorPassword } from '../../../../../server/authentication-policy.cjs';

export async function GET(request: Request) {
  const principal = await readAdminSession(request);
  return authenticationResponse({ authenticated: Boolean(principal), principal: principal || null,
    configured: administratorLoginEnabled() && Boolean(administratorPassword()) });
}

import { OAuth2Client } from 'google-auth-library';
import { AppError } from '../errors';

export interface VerifiedGoogleToken {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

/** Verifies a Google Identity Services ID token (signature, expiry and audience). */
export type GoogleVerifier = (credential: string) => Promise<VerifiedGoogleToken>;

export function createGoogleVerifier(clientId: string): GoogleVerifier {
  const client = new OAuth2Client(clientId);
  return async (credential) => {
    let payload;
    try {
      const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
      payload = ticket.getPayload();
    } catch {
      throw new AppError('INVALID_CREDENTIAL', 'Google credential could not be verified', 401);
    }
    if (!payload?.sub || !payload.email) {
      throw new AppError('INVALID_CREDENTIAL', 'Google credential has no email', 401);
    }
    return {
      sub: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      name: payload.name ?? null,
      picture: payload.picture ?? null,
    };
  };
}

import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

/** Identity asserted by a verified identity-provider token. */
export interface VerifiedIdentity {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

export interface TokenVerifier {
  readonly kind: 'firebase' | 'test';
  /** Resolves only for a cryptographically verified token; rejects otherwise. */
  verify(token: string): Promise<VerifiedIdentity>;
}

/**
 * Production verifier. Firebase ID-token verification needs only the project id
 * (Google's public signing keys are fetched by firebase-admin); no service-account
 * key is required or accepted from configuration.
 */
export function createFirebaseVerifier(projectId: string): TokenVerifier {
  const appName = 'boa-ims-auth';
  const app = getApps().find((a) => a.name === appName) ?? initializeApp({ projectId }, appName);
  const auth = getAuth(app);
  return {
    kind: 'firebase',
    async verify(token) {
      const decoded = await auth.verifyIdToken(token);
      return {
        uid: decoded.uid,
        email: typeof decoded.email === 'string' ? decoded.email : null,
        emailVerified: decoded.email_verified === true,
        name: typeof decoded.name === 'string' ? decoded.name : null,
      };
    },
  };
}

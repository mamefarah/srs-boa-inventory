import type { TokenVerifier } from './token-verifier.ts';

/**
 * TEST-ONLY token verifier. It is never imported by the production entrypoint
 * (`server/index.ts`), and it refuses to be constructed unless NODE_ENV=test AND
 * BOA_TEST_AUTH=enabled.
 *
 * Token format: `mock-token-<uid>` → identity `<uid>` with email `<uid>@example.invalid`.
 * A uid starting with `unverified-` yields an identity whose email is not verified.
 */
export function createTestVerifier(env: NodeJS.ProcessEnv = process.env): TokenVerifier {
  if (env.NODE_ENV !== 'test' || env.BOA_TEST_AUTH !== 'enabled') {
    throw new Error('Test token verifier requires NODE_ENV=test and BOA_TEST_AUTH=enabled');
  }
  return {
    kind: 'test',
    async verify(token) {
      const m = /^mock-token-([A-Za-z0-9_-]{1,128})$/.exec(token);
      if (!m) throw new Error('invalid test token');
      const uid = m[1];
      return {
        uid,
        email: `${uid}@example.invalid`,
        emailVerified: !uid.startsWith('unverified-'),
        name: `Test ${uid}`,
      };
    },
  };
}

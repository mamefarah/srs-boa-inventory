/**
 * Validates that a `redirectTo` value is a same-origin, path-only target before it is
 * used in a redirect. A bare `path.startsWith("/")` check is not enough: browsers treat
 * a protocol-relative URL like `//evil.com` (and the backslash variant `/\evil.com`,
 * which some browsers normalize to `//evil.com`) as an absolute, cross-origin redirect,
 * so that check alone is an open-redirect vulnerability.
 */
export function safeRedirectTarget(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.length === 0) {
    return fallback;
  }
  if (!value.startsWith("/")) {
    return fallback;
  }
  if (value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }
  return value;
}

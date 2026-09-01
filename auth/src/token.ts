import type { ShouldRefreshTokenOptions, TokenPayload } from "./types.js";

/**
 * Decode a JWT token without verifying the signature.
 * Used for reading expiration time on the client/middleware.
 */
export function decodeToken(token: string): TokenPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const payload = JSON.parse(atob(parts[1]!));
    return payload as TokenPayload;
  } catch {
    return null;
  }
}

/**
 * Check if a JWT token is expired.
 * @param token - The JWT token to check
 * @param bufferSeconds - Seconds before actual expiry to consider it expired. Default: 0
 */
export function isTokenExpired(token: string, bufferSeconds = 0): boolean {
  const payload = decodeToken(token);
  if (!payload) return true;
  if (!payload.exp) return false; // No expiration claim

  const now = Math.floor(Date.now() / 1000);
  return payload.exp < now + bufferSeconds;
}

/**
 * Whether a token is close enough to expiry that it should be refreshed now.
 *
 * The buffer is a share of the token's own lifetime rather than a fixed number of
 * seconds, because a fixed buffer wide enough to ride out a deploy would mark every
 * short-lived token as expired the moment it was issued. What the buffer buys is
 * runway: a refresh that fails while the API is briefly unreachable gets retried on
 * each following request, instead of the caller being stranded with a dead token.
 */
export function shouldRefreshToken(
  token: string,
  { elapsedFraction = 0.75, minBufferSeconds = 10 }: ShouldRefreshTokenOptions = {},
): boolean {
  const payload = decodeToken(token);
  if (!payload) return true;
  if (!payload.exp) return false; // No expiration claim

  // no iat means no lifetime to scale against, so the floor is all we have
  const lifetime = payload.iat ? payload.exp - payload.iat : 0;
  const buffer = Math.max(minBufferSeconds, lifetime * (1 - elapsedFraction));

  const now = Math.floor(Date.now() / 1000);
  return payload.exp < now + buffer;
}

import type { TokenPayload } from "./types.js";

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

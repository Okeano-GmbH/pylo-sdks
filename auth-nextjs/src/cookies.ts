import { cookies, headers } from "next/headers.js";
import { NextResponse } from "next/server.js";
import type { CookieOptions } from "@pylo/auth";

// Header set by middleware when auth refresh fails
const AUTH_FAILED_HEADER = "x-pylo-auth-failed";
// Header set by middleware with refreshed auth token
const AUTH_TOKEN_HEADER = "x-pylo-auth-token";

const DEFAULT_COOKIE_OPTIONS: Required<CookieOptions> = {
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  domain: "",
  path: "/",
  authMaxAge: 60 * 60, // 1 hour
  refreshMaxAge: 60 * 60 * 24 * 7, // 7 days
};

function getAppId(): string {
  const appId = process.env.PYLO_APP_ID;
  if (!appId) {
    throw new Error("[pylo-auth] Missing required PYLO_APP_ID environment variable");
  }
  return appId;
}

/**
 * Get the app-scoped auth token cookie name
 */
export function getAuthTokenCookieName(): string {
  return `pylo_auth_token_${getAppId()}`;
}

/**
 * Get the app-scoped refresh token cookie name
 */
export function getRefreshTokenCookieName(): string {
  return `pylo_refresh_token_${getAppId()}`;
}

/**
 * Get merged cookie options with defaults
 */
export function getCookieOptions(options?: CookieOptions): Required<CookieOptions> {
  return {
    ...DEFAULT_COOKIE_OPTIONS,
    ...options,
  };
}

/**
 * Get auth token from cookies (server context).
 * Returns undefined if middleware flagged auth as failed (e.g., refresh token expired).
 *
 * Priority:
 * 1. Check if middleware flagged auth as failed → return undefined
 * 2. Check for refreshed token header (set by middleware after token refresh) → return header value
 * 3. Fall back to cookie value
 */
export async function getAuthToken(): Promise<string | undefined> {
  const hdrs = await headers();

  // Check if middleware flagged auth as failed (e.g., refresh token expired)
  if (hdrs.get(AUTH_FAILED_HEADER) === 'true') {
    return undefined;
  }

  // Check for refreshed token from middleware (set when token was refreshed)
  const refreshedToken = hdrs.get(AUTH_TOKEN_HEADER);
  if (refreshedToken) {
    return refreshedToken;
  }

  // Fall back to cookie
  const cookieStore = await cookies();
  return cookieStore.get(getAuthTokenCookieName())?.value;
}

/**
 * Get refresh token from cookies (server context)
 */
export async function getRefreshToken(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(getRefreshTokenCookieName())?.value;
}

/**
 * Set auth cookies (server context)
 */
export async function setAuthCookies(
  authToken: string,
  refreshToken: string,
  options?: CookieOptions
): Promise<void> {
  const cookieStore = await cookies();
  const opts = getCookieOptions(options);

  const baseOptions = {
    httpOnly: true,
    secure: opts.secure,
    sameSite: opts.sameSite,
    path: opts.path,
    ...(opts.domain ? { domain: opts.domain } : {}),
  } as const;

  cookieStore.set(getAuthTokenCookieName(), authToken, {
    ...baseOptions,
    maxAge: opts.authMaxAge,
  });

  cookieStore.set(getRefreshTokenCookieName(), refreshToken, {
    ...baseOptions,
    maxAge: opts.refreshMaxAge,
  });
}

/**
 * Clear auth cookies (server context)
 */
export async function clearAuthCookies(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(getAuthTokenCookieName());
  cookieStore.delete(getRefreshTokenCookieName());
}

/**
 * Set auth cookies on a NextResponse (middleware context)
 */
export function setAuthCookiesOnResponse(
  response: NextResponse,
  authToken: string,
  refreshToken: string,
  options?: CookieOptions
): void {
  const opts = getCookieOptions(options);

  const baseOptions = {
    httpOnly: true,
    secure: opts.secure,
    sameSite: opts.sameSite,
    path: opts.path,
    ...(opts.domain ? { domain: opts.domain } : {}),
  } as const;

  response.cookies.set(getAuthTokenCookieName(), authToken, {
    ...baseOptions,
    maxAge: opts.authMaxAge,
  });

  response.cookies.set(getRefreshTokenCookieName(), refreshToken, {
    ...baseOptions,
    maxAge: opts.refreshMaxAge,
  });
}

/**
 * Clear auth cookies on a NextResponse (middleware context)
 */
export function clearAuthCookiesOnResponse(response: NextResponse): void {
  response.cookies.delete(getAuthTokenCookieName());
  response.cookies.delete(getRefreshTokenCookieName());
}

import { cookies } from "next/headers.js";
import { NextResponse } from "next/server.js";
import type { CookieOptions } from "@okeano-gmbh/pylo-auth";

// Cookie names with pylo prefix
const AUTH_TOKEN_COOKIE = "pylo_auth_token";
const REFRESH_TOKEN_COOKIE = "pylo_refresh_token";

const DEFAULT_COOKIE_OPTIONS: Required<CookieOptions> = {
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  domain: "",
  path: "/",
  authMaxAge: 60 * 60, // 1 hour
  refreshMaxAge: 60 * 60 * 24 * 7, // 7 days
};

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
 * Get auth token from cookies (server context)
 */
export async function getAuthToken(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(AUTH_TOKEN_COOKIE)?.value;
}

/**
 * Get refresh token from cookies (server context)
 */
export async function getRefreshToken(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;
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

  cookieStore.set(AUTH_TOKEN_COOKIE, authToken, {
    ...baseOptions,
    maxAge: opts.authMaxAge,
  });

  cookieStore.set(REFRESH_TOKEN_COOKIE, refreshToken, {
    ...baseOptions,
    maxAge: opts.refreshMaxAge,
  });
}

/**
 * Clear auth cookies (server context)
 */
export async function clearAuthCookies(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_TOKEN_COOKIE);
  cookieStore.delete(REFRESH_TOKEN_COOKIE);
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

  response.cookies.set(AUTH_TOKEN_COOKIE, authToken, {
    ...baseOptions,
    maxAge: opts.authMaxAge,
  });

  response.cookies.set(REFRESH_TOKEN_COOKIE, refreshToken, {
    ...baseOptions,
    maxAge: opts.refreshMaxAge,
  });
}

/**
 * Clear auth cookies on a NextResponse (middleware context)
 */
export function clearAuthCookiesOnResponse(response: NextResponse): void {
  response.cookies.delete(AUTH_TOKEN_COOKIE);
  response.cookies.delete(REFRESH_TOKEN_COOKIE);
}

// Export cookie names for use in middleware
export { AUTH_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE };

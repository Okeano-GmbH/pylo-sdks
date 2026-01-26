import type { NextResponse, NextRequest } from "next/server.js";
import type { PyloUser, CookieOptions } from "@okeano-gmbh/pylo-auth";

/**
 * Options for the pyloAuth middleware helper
 */
export interface PyloAuthOptions {
  /** Path to redirect to when not authenticated. Default: '/auth/login' */
  loginPath?: string;
  /** GraphQL API endpoint. Default: 'https://api.pyloapp.com/graphql' */
  graphqlEndpoint?: string;
  /** Optional Pylo App ID for multi-app setups */
  appId?: string;
  /** Seconds before token expiry to trigger refresh. Default: 60 */
  tokenRefreshBuffer?: number;
  /** Cookie configuration options */
  cookies?: CookieOptions;
  /** Paths that don't require authentication. Default: ['/auth'] */
  publicPaths?: string[];
}

/**
 * Auth context returned by pyloAuth
 */
export interface AuthContext {
  /** The authenticated user, or null if not logged in */
  user: PyloUser | null;
  /** True if user is authenticated */
  loggedIn: boolean;
  /** Redirect to login page with returnTo parameter */
  redirectToLogin: () => NextResponse;
  /** The NextResponse to return (with any updated cookies) */
  response: NextResponse;
}

/**
 * Options for requireAuth
 */
export interface RequireAuthOptions {
  /** Path to redirect to when not authenticated. Default: '/auth/login' */
  redirectTo?: string;
}

/**
 * Internal type for middleware request with cookies
 */
export type MiddlewareRequest = NextRequest;

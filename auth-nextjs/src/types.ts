import type { NextResponse, NextRequest } from "next/server.js";
import type { PyloUser, CookieOptions } from "@pylo/auth";

/**
 * Options for the pyloAuth middleware helper
 */
export interface PyloAuthOptions {
  /** Path to redirect to when not authenticated. Default: '/auth/login' */
  loginPath?: string;
  /** GraphQL API endpoint. Default: 'https://api.pyloapp.com/graphql' */
  graphqlEndpoint?: string;
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
  /**
   * Smart redirect that handles Server Actions and API routes automatically.
   * - For page requests: returns NextResponse.redirect(url)
   * - For Server Actions/API routes/public paths: returns response (pass through)
   */
  redirect: (url: string | URL) => NextResponse;
  /** @deprecated Use redirect() instead */
  redirectToLogin: () => NextResponse;
  /** The NextResponse to return (with any updated cookies) */
  response: NextResponse;
  /** True if this is a Server Action request */
  isServerAction: boolean;
  /** True if this is an API route request */
  isApiRoute: boolean;
}

/**
 * Error thrown by requireAuth when mode is "throw" and the user is not authenticated.
 */
export class NotAuthenticatedError extends Error {
  constructor(message = "Not authenticated") {
    super(message);
    this.name = "NotAuthenticatedError";
  }
}

/**
 * Options for requireAuth
 */
export interface RequireAuthOptions {
  /** Path to redirect to when not authenticated. Default: '/auth/login' */
  redirectTo?: string;
  /**
   * How to handle unauthenticated requests.
   * - "redirect" (default): Redirect to the login page. Use in Server Components / pages.
   * - "throw": Throw a NotAuthenticatedError. Use in API Route Handlers.
   */
  mode?: "redirect" | "throw";
}

/**
 * Internal type for middleware request with cookies
 */
export type MiddlewareRequest = NextRequest;

import { NextResponse } from "next/server.js";
import type { NextRequest } from "next/server.js";
import {
  isTokenExpired,
  graphqlRequest,
  DEFAULT_GRAPHQL_ENDPOINT,
  REFRESH_TOKEN_MUTATION,
  type RefreshTokenResponse,
  type PyloUser,
} from "@okeano-gmbh/pylo-auth";
import type { PyloAuthOptions, AuthContext } from "./types.js";
import {
  setAuthCookiesOnResponse,
  clearAuthCookiesOnResponse,
  AUTH_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from "./cookies.js";

/**
 * Full middleware handler that protects routes and handles auth automatically.
 * This is the simplest way to add auth to your Next.js app.
 *
 * @example
 * ```ts
 * // proxy.ts
 * import { createPyloProxy } from '@okeano-gmbh/pylo-auth-nextjs'
 *
 * export const proxy = createPyloProxy({
 *   publicPaths: ['/auth', '/public'],
 * })
 *
 * export const config = {
 *   matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*|$).*)'],
 * }
 * ```
 */
export function createPyloProxy(options?: PyloAuthOptions) {
  return async function proxy(request: NextRequest): Promise<NextResponse> {
    const { pathname } = request.nextUrl;
    const publicPaths = options?.publicPaths ?? ["/auth"];

    // Check if this is a public path
    const isPublicPath = publicPaths.some((path) => pathname.startsWith(path));

    if (isPublicPath) {
      return NextResponse.next();
    }

    // Run auth check
    const auth = await pyloAuth(request, options);

    if (!auth.loggedIn) {
      return auth.redirectToLogin();
    }

    return auth.response;
  };
}

/**
 * Middleware helper that handles token refresh and returns auth state.
 * Use this inside your Next.js middleware for more control.
 *
 * @example
 * ```ts
 * import { NextResponse } from 'next/server'
 * import { pyloAuth } from '@okeano-gmbh/pylo-auth-nextjs'
 *
 * export async function proxy(request) {
 *   const auth = await pyloAuth(request)
 *
 *   if (!auth.loggedIn && !request.nextUrl.pathname.startsWith('/auth')) {
 *     return auth.redirectToLogin()
 *   }
 *
 *   // your custom middleware code
 *
 *   return auth.response
 * }
 * ```
 */
export async function pyloAuth(
  request: NextRequest,
  options?: PyloAuthOptions
): Promise<AuthContext> {
  const loginPath = options?.loginPath ?? "/auth/login";
  const graphqlEndpoint = options?.graphqlEndpoint ?? process.env.PYLO_GRAPHQL_ENDPOINT ?? DEFAULT_GRAPHQL_ENDPOINT;
  const appId = options?.appId ?? process.env.PYLO_APP_ID;
  const cookieOptions = options?.cookies;

  const authToken = request.cookies.get(AUTH_TOKEN_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;

  // Create response object that we may modify
  let response = NextResponse.next();
  let user: PyloUser | null = null;
  let loggedIn = false;

  // Helper to redirect to login
  const redirectToLogin = (): NextResponse => {
    const loginUrl = new URL(loginPath, request.url);
    const redirectResponse = NextResponse.redirect(loginUrl);
    clearAuthCookiesOnResponse(redirectResponse);
    return redirectResponse;
  };

  // No tokens at all
  if (!authToken && !refreshToken) {
    return { user: null, loggedIn: false, redirectToLogin, response };
  }

  // Check if token is expired (not just within buffer - buffer causes race conditions with parallel requests)
  const isExpired = !authToken || isTokenExpired(authToken, 0);

  if (isExpired && refreshToken) {
    // Token is expired, attempt to refresh
    const result = await refreshTokens(graphqlEndpoint, refreshToken, appId);

    if (result.success && result.authToken && result.refreshToken) {
      // Refresh succeeded - set new cookies on response
      setAuthCookiesOnResponse(response, result.authToken, result.refreshToken, cookieOptions);
      loggedIn = true;
    } else {
      // Refresh failed - clear cookies
      clearAuthCookiesOnResponse(response);
      return { user: null, loggedIn: false, redirectToLogin, response };
    }
  } else if (authToken && !isExpired) {
    // Valid token exists
    loggedIn = true;
  }

  return { user, loggedIn, redirectToLogin, response };
}

/**
 * Refresh tokens using the GraphQL API
 */
async function refreshTokens(
  endpoint: string,
  refreshToken: string,
  appId?: string
): Promise<{ success: boolean; authToken?: string; refreshToken?: string }> {
  try {
    const response = await graphqlRequest<RefreshTokenResponse>(
      endpoint,
      REFRESH_TOKEN_MUTATION,
      { input: { refresh_token: refreshToken } },
      appId ? { appId } : undefined
    );

    if (response.data?.refreshToken?.data) {
      return {
        success: true,
        authToken: response.data.refreshToken.data.auth_token,
        refreshToken: response.data.refreshToken.data.refresh_token,
      };
    }

    return { success: false };
  } catch {
    return { success: false };
  }
}

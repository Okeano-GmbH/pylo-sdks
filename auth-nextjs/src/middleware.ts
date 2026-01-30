import { NextResponse } from "next/server.js";
import type { NextRequest } from "next/server.js";
import {
  isTokenExpired,
  graphqlRequest,
  DEFAULT_GRAPHQL_ENDPOINT,
  REFRESH_TOKEN_MUTATION,
  type RefreshTokenResponse,
  type PyloUser,
} from "@pylo/auth";
import type { PyloAuthOptions, AuthContext } from "./types.js";
import {
  setAuthCookiesOnResponse,
  clearAuthCookiesOnResponse,
  AUTH_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from "./cookies.js";

/**
 * Detect if this is a Server Action request.
 * Server Actions are identified by:
 * - `next-action` header (always present for Server Actions)
 * - `text/x-component` in Accept header (RSC payload)
 * - `multipart/form-data` content type (form submissions)
 */
function isServerActionRequest(request: NextRequest): boolean {
  const nextAction = request.headers.get('next-action');
  const contentType = request.headers.get('content-type') || '';
  const accept = request.headers.get('accept') || '';

  return !!(
    nextAction ||
    accept.includes('text/x-component') ||
    contentType.includes('multipart/form-data')
  );
}

/**
 * Detect if this is an API route request.
 */
function isApiRouteRequest(request: NextRequest): boolean {
  return request.nextUrl.pathname.startsWith('/api/');
}

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
    const loginPath = options?.loginPath ?? "/auth/login";

    // Check if this is a public path - skip auth entirely
    const isPublicPath = publicPaths.some((path) => pathname.startsWith(path));
    if (isPublicPath) {
      return NextResponse.next();
    }

    // Run auth check
    const auth = await pyloAuth(request, options);

    if (!auth.loggedIn) {
      // Redirect to login with the current path as redirect parameter
      const loginUrl = new URL(loginPath, request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return auth.redirect(loginUrl);
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
 * import { pyloAuth } from '@okeano-gmbh/pylo-auth-nextjs'
 *
 * export async function proxy(request) {
 *   const auth = await pyloAuth(request, {
 *     publicPaths: ['/auth'],
 *   })
 *
 *   if (!auth.loggedIn) {
 *     // redirect() handles Server Actions, API routes, and public paths automatically
 *     const loginUrl = new URL('/auth/login', request.url)
 *     loginUrl.searchParams.set('redirect', request.nextUrl.pathname)
 *     return auth.redirect(loginUrl)
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
  const publicPaths = options?.publicPaths ?? ["/auth"];
  const { pathname } = request.nextUrl;

  const authToken = request.cookies.get(AUTH_TOKEN_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;

  // Detect request context
  const isServerAction = isServerActionRequest(request);
  const isApiRoute = isApiRouteRequest(request);
  const isPublicPath = publicPaths.some((path) => pathname.startsWith(path));

  // Create request headers that we can modify to pass tokens to route handlers
  const requestHeaders = new Headers(request.headers);

  // Create response object that we may modify
  let response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  let user: PyloUser | null = null;
  let loggedIn = false;

  // Smart redirect helper - handles Server Actions, API routes, and public paths automatically
  const createRedirect = (currentResponse: NextResponse) => (url: string | URL): NextResponse => {
    // For Server Actions, API routes, or public paths - pass through
    if (isServerAction || isApiRoute || isPublicPath) {
      return currentResponse;
    }
    // For page requests - redirect
    const redirectResponse = NextResponse.redirect(url);
    clearAuthCookiesOnResponse(redirectResponse);
    return redirectResponse;
  };

  // Legacy helper for backwards compatibility
  const redirectToLogin = (): NextResponse => {
    const loginUrl = new URL(loginPath, request.url);
    const redirectResponse = NextResponse.redirect(loginUrl);
    clearAuthCookiesOnResponse(redirectResponse);
    return redirectResponse;
  };

  // No tokens at all
  if (!authToken && !refreshToken) {
    return { user: null, loggedIn: false, redirect: createRedirect(response), redirectToLogin, response, isServerAction, isApiRoute };
  }

  // Check if token is expired or will expire within 10 seconds
  // Note: buffer must be shorter than token lifetime (currently ~30s)
  const isExpired = !authToken || isTokenExpired(authToken, 10);

  // Store refresh result to avoid duplicate calls
  let refreshResult: { success: boolean; authToken?: string; refreshToken?: string } | null = null;

  if (isExpired && refreshToken) {
    // Token is expired, attempt to refresh
    refreshResult = await refreshTokens(graphqlEndpoint, refreshToken, appId);

    if (refreshResult.success && refreshResult.authToken && refreshResult.refreshToken) {
      // Refresh succeeded
      loggedIn = true;
    } else {
      // Refresh failed - clear cookies and signal to downstream code
      clearAuthCookiesOnResponse(response);

      // Set a header to signal that auth failed (for Server Actions/API routes that pass through)
      requestHeaders.set('x-pylo-auth-failed', 'true');
      response = NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      });
      clearAuthCookiesOnResponse(response);

      return { user: null, loggedIn: false, redirect: createRedirect(response), redirectToLogin, response, isServerAction, isApiRoute };
    }
  } else if (authToken && !isExpired) {
    // Valid token exists
    loggedIn = true;
  }

  // If we refreshed, update the request cookies so route handlers see the new tokens
  if (refreshResult?.success && refreshResult.authToken && refreshResult.refreshToken) {
    // Parse existing cookies and update with new tokens
    const existingCookies = request.headers.get('cookie') || '';
    const cookiePairs = existingCookies.split(';').map(c => c.trim()).filter(Boolean);

    // Remove old auth cookies and add new ones
    const filteredCookies = cookiePairs.filter(c => {
      const name = c.split('=')[0];
      return name !== AUTH_TOKEN_COOKIE && name !== REFRESH_TOKEN_COOKIE;
    });

    filteredCookies.push(`${AUTH_TOKEN_COOKIE}=${refreshResult.authToken}`);
    filteredCookies.push(`${REFRESH_TOKEN_COOKIE}=${refreshResult.refreshToken}`);

    // Update the cookie header on the request
    requestHeaders.set('cookie', filteredCookies.join('; '));

    // Also set a custom header with the refreshed auth token for API routes
    // (cookies() from next/headers reads original cookies, not middleware-modified ones)
    requestHeaders.set('x-pylo-auth-token', refreshResult.authToken);

    // Recreate response with updated request cookies
    response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });

    // Set cookies on response to send new tokens back to browser
    setAuthCookiesOnResponse(response, refreshResult.authToken, refreshResult.refreshToken, cookieOptions);
  }

  return { user, loggedIn, redirect: createRedirect(response), redirectToLogin, response, isServerAction, isApiRoute };
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
  } catch (error) {
    console.error('[pylo-auth] Token refresh error:', error);
    return { success: false };
  }
}

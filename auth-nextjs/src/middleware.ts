import { NextResponse } from "next/server.js";
import type { NextRequest } from "next/server.js";
import {
  isTokenExpired,
  shouldRefreshToken,
  graphqlRequest,
  isUnauthorizedError,
  extractErrorMessage,
  DEFAULT_GRAPHQL_ENDPOINT,
  REFRESH_TOKEN_MUTATION,
  type RefreshTokenResponse,
  type GraphQLResponse,
  type PyloUser,
} from "@pylo/auth";
import type { PyloAuthOptions, AuthContext } from "./types.js";
import {
  setAuthCookiesOnResponse,
  clearAuthCookiesOnResponse,
  getAuthTokenCookieName,
  getRefreshTokenCookieName,
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
 *     const loginUrl = new URL('/auth/login', request.url)
 *     loginUrl.searchParams.set('redirect', request.nextUrl.pathname)
 *     return auth.redirect(loginUrl)
 *   }
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
  const cookieOptions = options?.cookies;
  const publicPaths = options?.publicPaths ?? ["/auth"];
  const tokenRefreshBuffer = options?.tokenRefreshBuffer;
  const { pathname } = request.nextUrl;

  const authTokenCookieName = getAuthTokenCookieName();
  const refreshTokenCookieName = getRefreshTokenCookieName();

  const authToken = request.cookies.get(authTokenCookieName)?.value;
  const refreshToken = request.cookies.get(refreshTokenCookieName)?.value;

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
  const user: PyloUser | null = null;
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

  // Refresh while the token still has life left: that remainder is the window in
  // which a failed refresh gets retried on each following request, so an API that
  // is briefly unreachable (a deploy, say) costs a retry rather than the session.
  const isExpired =
    !authToken ||
    (tokenRefreshBuffer === undefined
      ? shouldRefreshToken(authToken)
      : isTokenExpired(authToken, tokenRefreshBuffer));

  // Store refresh result to avoid duplicate calls
  let refreshResult: RefreshOutcome | null = null;

  if (isExpired && refreshToken) {
    // Token is expired, attempt to refresh
    refreshResult = await refreshTokens(graphqlEndpoint, refreshToken);

    if (refreshResult.status === "refreshed") {
      // Refresh succeeded
      loggedIn = true;
    } else if (refreshResult.status === "invalid") {
      // The refresh token was genuinely rejected by the backend (expired /
      // revoked / invalid) - end the session by clearing cookies and signal to
      // downstream code.
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
    } else {
      // Transient failure: the backend was unreachable / redeploying / returned
      // a non-auth error. Do NOT clear cookies - keep the session intact so it
      // recovers on the next request instead of logging the user out on a brief
      // backend blip (e.g. during a deploy). Treat the user as still
      // authenticated for this request; the (expired) access token is left in
      // place and a later request will refresh it once the backend is healthy.
      requestHeaders.set('x-pylo-auth-refresh-failed', 'true');
      response = NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      });
      loggedIn = true;
    }
  } else if (authToken && !isExpired) {
    // Valid token exists
    loggedIn = true;
  }

  // If we refreshed, update the request cookies so route handlers see the new tokens
  if (refreshResult?.status === "refreshed") {
    // Parse existing cookies and update with new tokens
    const existingCookies = request.headers.get('cookie') || '';
    const cookiePairs = existingCookies.split(';').map(c => c.trim()).filter(Boolean);

    // Remove old auth cookies and add new ones
    const filteredCookies = cookiePairs.filter(c => {
      const name = c.split('=')[0];
      return name !== authTokenCookieName && name !== refreshTokenCookieName;
    });

    filteredCookies.push(`${authTokenCookieName}=${refreshResult.authToken}`);
    filteredCookies.push(`${refreshTokenCookieName}=${refreshResult.refreshToken}`);

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
 * Outcome of a token refresh attempt.
 *
 * - `refreshed`: the backend issued a new token pair.
 * - `invalid`:   the backend explicitly rejected the refresh token (expired /
 *                revoked / invalid) - the session should be ended.
 * - `error`:     a transient failure (network error, timeout, 5xx, non-JSON
 *                body, or any non-auth GraphQL error). The session must be
 *                preserved so it can recover on a later request.
 */
type RefreshOutcome =
  | { status: "refreshed"; authToken: string; refreshToken: string }
  | { status: "invalid" }
  | { status: "error" };

/**
 * Refresh tokens using the GraphQL API.
 *
 * Critically, this distinguishes a genuine auth failure (the refresh token was
 * rejected -> log out) from a transient backend problem (unreachable, mid-deploy,
 * 5xx -> keep the session). Treating the two the same is what logs users out
 * whenever the backend blips.
 */
async function refreshTokens(
  endpoint: string,
  refreshToken: string
): Promise<RefreshOutcome> {
  let response: GraphQLResponse<RefreshTokenResponse>;

  try {
    response = await graphqlRequest<RefreshTokenResponse>(
      endpoint,
      REFRESH_TOKEN_MUTATION,
      { input: { refresh_token: refreshToken } }
    );
  } catch (error) {
    // fetch() rejected (network error / DNS / connection refused) or the body
    // failed to parse as JSON (e.g. an HTML 5xx gateway page served while the
    // backend redeploys). This is transient - never end the session over it.
    console.error('[pylo-auth] Token refresh request failed (transient):', error);
    return { status: "error" };
  }

  const data = response.data?.refreshToken?.data;
  if (data?.auth_token && data?.refresh_token) {
    return {
      status: "refreshed",
      authToken: data.auth_token,
      refreshToken: data.refresh_token,
    };
  }

  // The server answered but returned no tokens. Only end the session when it
  // explicitly reports an auth failure; anything else is treated as transient.
  if (isUnauthorizedError(response)) {
    return { status: "invalid" };
  }

  console.error(
    '[pylo-auth] Token refresh returned no tokens (transient):',
    extractErrorMessage(response.errors)
  );
  return { status: "error" };
}

import {
  graphqlRequest,
  hasErrors,
  extractErrorMessage,
  isUnauthorizedError,
  DEFAULT_GRAPHQL_ENDPOINT,
  LOGIN_MUTATION,
  REFRESH_TOKEN_MUTATION,
  ME_QUERY,
  type PyloUser,
  type AuthResult,
  type LoginResponse,
  type RefreshTokenResponse,
  type MeResponse,
} from "@pylo/auth";
import type { RequireAuthOptions } from "./types.js";
import { NotAuthenticatedError } from "./types.js";
import { getAuthToken, getRefreshToken, setAuthCookies, clearAuthCookies } from "./cookies.js";

const getEndpoint = (): string =>
  process.env.PYLO_GRAPHQL_ENDPOINT ?? process.env.GRAPHQL_ENDPOINT ?? DEFAULT_GRAPHQL_ENDPOINT;

const getAppId = (): string => {
  const appId = process.env.PYLO_APP_ID;
  if (!appId) {
    throw new Error("[pylo-auth] Missing required PYLO_APP_ID environment variable");
  }
  return appId;
};

/**
 * Get the currently authenticated user.
 * Returns null if not authenticated.
 *
 * @example
 * ```ts
 * import { getUser } from '@okeano-gmbh/pylo-auth-nextjs'
 *
 * export default async function ProfilePage() {
 *   const user = await getUser()
 *
 *   if (!user) {
 *     return <p>Not logged in</p>
 *   }
 *
 *   return <p>Email: {user.email}</p>
 * }
 * ```
 */
export async function getUser(): Promise<PyloUser | null> {
  const token = await getAuthToken();
  if (!token) return null;

  const endpoint = getEndpoint();

  const response = await graphqlRequest<MeResponse>(
    endpoint,
    ME_QUERY,
    undefined,
    { token }
  );

  if (hasErrors(response) || !response.data) {
    return null;
  }

  return response.data.me.current_user.data;
}

/**
 * Check if the current request is authenticated.
 *
 * @example
 * ```ts
 * import { loggedIn } from '@okeano-gmbh/pylo-auth-nextjs'
 *
 * export default async function Page() {
 *   if (await loggedIn()) {
 *     return <AuthenticatedContent />
 *   }
 *   return <PublicContent />
 * }
 * ```
 */
export async function loggedIn(): Promise<boolean> {
  const token = await getAuthToken();
  return token !== undefined;
}

/**
 * Get the user or handle unauthenticated requests.
 *
 * Supports two modes:
 * - `"redirect"` (default): Redirects to the login page. Use in Server Components / pages.
 * - `"throw"`: Throws a `NotAuthenticatedError`. Use in API Route Handlers.
 *
 * @example Server Component (default redirect mode)
 * ```ts
 * import { requireAuth } from '@pylo/auth-nextjs'
 *
 * export default async function DashboardPage() {
 *   const user = await requireAuth()
 *   return <Dashboard user={user} />
 * }
 * ```
 *
 * @example API Route Handler (throw mode)
 * ```ts
 * import { requireAuth } from '@pylo/auth-nextjs'
 *
 * export async function GET() {
 *   const user = await requireAuth({ mode: "throw" })
 *   return Response.json({ user })
 * }
 * ```
 */
export async function requireAuth(options?: RequireAuthOptions): Promise<PyloUser> {
  const user = await getUser();

  if (!user) {
    if (options?.mode === "throw") {
      throw new NotAuthenticatedError();
    }

    // Lazy import to avoid pulling in next/navigation at module parse time,
    // which fails in Route Handlers where app-router-context is unavailable.
    const nav = await import("next/navigation.js");
    const redirectTo = options?.redirectTo ?? "/auth/login";
    nav.redirect(redirectTo);
    // redirect() throws internally and never returns, but TS doesn't know that
    // from a dynamic import. This line is unreachable.
    throw new Error("Unreachable");
  }

  return user;
}

/**
 * Authenticate a user with email and password.
 * Sets auth cookies on success.
 *
 * @example
 * ```ts
 * 'use server'
 * import { login } from '@okeano-gmbh/pylo-auth-nextjs'
 *
 * export async function loginAction(formData: FormData) {
 *   const email = formData.get('email') as string
 *   const password = formData.get('password') as string
 *   return login(email, password)
 * }
 * ```
 */
export async function login(email: string, password: string): Promise<AuthResult> {
  const appId = getAppId();
  const endpoint = getEndpoint();

  const response = await graphqlRequest<LoginResponse>(
    endpoint,
    LOGIN_MUTATION,
    { input: { email, password, pylo_app_id: appId } }
  );

  if (hasErrors(response)) {
    const message = extractErrorMessage(response.errors) ?? "Login failed";
    return {
      success: false,
      error: { code: "INVALID_CREDENTIALS", message },
    };
  }

  if (!response.data) {
    return {
      success: false,
      error: { code: "SERVER_ERROR", message: "No data returned" },
    };
  }

  const { auth_token, refresh_token } = response.data.login.data;

  await setAuthCookies(auth_token, refresh_token);

  // Fetch user after login
  const user = await getUser();

  const result: AuthResult = {
    success: true,
    authToken: auth_token,
    refreshToken: refresh_token,
  };

  if (user) {
    result.user = user;
  }

  return result;
}

/**
 * Clear auth cookies and end the session.
 *
 * @example
 * ```ts
 * 'use server'
 * import { logout } from '@okeano-gmbh/pylo-auth-nextjs'
 * import { redirect } from 'next/navigation'
 *
 * export async function logoutAction() {
 *   await logout()
 *   redirect('/auth/login')
 * }
 * ```
 */
export async function logout(): Promise<void> {
  await clearAuthCookies();
}

/**
 * Manually refresh the auth token.
 * Usually not needed since middleware handles this automatically.
 */
export async function refreshTokens(): Promise<AuthResult> {
  const refreshToken = await getRefreshToken();

  if (!refreshToken) {
    return {
      success: false,
      error: { code: "TOKEN_EXPIRED", message: "No refresh token" },
    };
  }

  const response = await graphqlRequest<RefreshTokenResponse>(
    getEndpoint(),
    REFRESH_TOKEN_MUTATION,
    { input: { refresh_token: refreshToken } }
  );

  if (hasErrors(response)) {
    const message = extractErrorMessage(response.errors) ?? "Refresh failed";
    // Only end the session when the refresh token itself was rejected. A
    // transient backend error (5xx, mid-deploy, etc.) must NOT clear cookies,
    // otherwise every backend blip logs the user out.
    if (isUnauthorizedError(response)) {
      await clearAuthCookies();
      return {
        success: false,
        error: { code: "TOKEN_EXPIRED", message },
      };
    }
    return {
      success: false,
      error: { code: "SERVER_ERROR", message },
    };
  }

  if (!response.data) {
    // No errors but no data either - treat as a transient server problem and
    // keep the session rather than logging the user out.
    return {
      success: false,
      error: { code: "SERVER_ERROR", message: "No data returned" },
    };
  }

  const { auth_token, refresh_token } = response.data.refreshToken.data;

  await setAuthCookies(auth_token, refresh_token);

  return {
    success: true,
    authToken: auth_token,
    refreshToken: refresh_token,
  };
}

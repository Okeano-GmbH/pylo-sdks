import { cookies } from "next/headers.js";
import { redirect } from "next/navigation.js";
import {
  graphqlRequest,
  hasErrors,
  extractErrorMessage,
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
import { getAuthToken, getRefreshToken, setAuthCookies, clearAuthCookies } from "./cookies.js";

const getEndpoint = (): string =>
  process.env.PYLO_GRAPHQL_ENDPOINT ?? process.env.GRAPHQL_ENDPOINT ?? DEFAULT_GRAPHQL_ENDPOINT;
const getAppId = (): string | undefined => process.env.PYLO_APP_ID;

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

  const appId = getAppId();
  const endpoint = getEndpoint();

  const response = await graphqlRequest<MeResponse>(
    endpoint,
    ME_QUERY,
    undefined,
    appId ? { token, appId } : { token }
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
 * Get the user or redirect to login if not authenticated.
 * Use this when you know the page requires authentication.
 *
 * @example
 * ```ts
 * import { requireAuth } from '@okeano-gmbh/pylo-auth-nextjs'
 *
 * export default async function DashboardPage() {
 *   const user = await requireAuth()
 *   // User is guaranteed to exist here
 *   return <Dashboard user={user} />
 * }
 * ```
 */
export async function requireAuth(options?: RequireAuthOptions): Promise<PyloUser> {
  const user = await getUser();

  if (!user) {
    const redirectTo = options?.redirectTo ?? "/auth/login";
    redirect(redirectTo);
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
    { input: { email, password } },
    appId ? { appId } : undefined
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

  const appId = getAppId();
  const response = await graphqlRequest<RefreshTokenResponse>(
    getEndpoint(),
    REFRESH_TOKEN_MUTATION,
    { input: { refresh_token: refreshToken } },
    appId ? { appId } : undefined
  );

  if (hasErrors(response)) {
    await clearAuthCookies();
    const message = extractErrorMessage(response.errors) ?? "Refresh failed";
    return {
      success: false,
      error: { code: "TOKEN_EXPIRED", message },
    };
  }

  if (!response.data) {
    await clearAuthCookies();
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

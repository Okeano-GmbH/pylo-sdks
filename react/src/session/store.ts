import {
  graphqlRequest,
  hasErrors,
  extractErrorMessage,
  isUnauthorizedError,
  shouldRefreshToken,
  safeRedirectPath,
  LOGIN_MUTATION,
  REDEEM_LOGIN_HANDOFF_MUTATION,
  REFRESH_TOKEN_MUTATION,
} from "@pylo/auth";
import type {
  AuthResult,
  GraphQLResponse,
  LoginHandoffResponse,
  LoginResponse,
  RefreshTokenResponse,
} from "@pylo/auth";
import type { PyloStorage } from "./storage.js";

export type SessionStatus = "loading" | "loggedIn" | "loggedOut";

export interface SessionState {
  status: SessionStatus;
  token: string | null;
}

export interface SessionStoreOptions {
  endpoint: string;
  storage: PyloStorage;
  appId?: string;
  /** Namespaces the storage keys, for apps holding more than one session. */
  keyPrefix?: string;
  onLogout?: () => void;
  /** Called after a successful login or handoff, not after a refresh. */
  onLogin?: () => void;
}

export interface SessionStore {
  getState(): SessionState;
  subscribe(listener: () => void): () => void;
  init(): Promise<void>;
  /** The token to send, refreshed first if it is close enough to expiry. */
  getToken(): Promise<string | null>;
  /** Forces a refresh regardless of expiry. Used after a rejected request. */
  refresh(): Promise<string | null>;
  login(email: string, password: string): Promise<AuthResult>;
  /** Exchanges a social login handoff code. A failure leaves any existing session intact. */
  redeemHandoff(code: string, verifier: string): Promise<AuthResult & { redirect?: string }>;
  logout(): Promise<void>;
}

export function createSessionStore(options: SessionStoreOptions): SessionStore {
  const prefix = options.keyPrefix ?? "pylo";
  const AUTH_KEY = `${prefix}.auth_token`;
  const REFRESH_KEY = `${prefix}.refresh_token`;

  let state: SessionState = { status: "loading", token: null };
  let refreshToken: string | null = null;
  let inFlight: Promise<string | null> | null = null;
  let ready: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  function setState(next: SessionState): void {
    state = next;
    for (const listener of listeners) listener();
  }

  async function persist(auth: string, refresh: string): Promise<void> {
    refreshToken = refresh;
    await options.storage.setItem(AUTH_KEY, auth);
    await options.storage.setItem(REFRESH_KEY, refresh);
    setState({ status: "loggedIn", token: auth });
  }

  async function startSession(auth: string, refresh: string): Promise<void> {
    await persist(auth, refresh);
    options.onLogin?.();
  }

  async function clear(): Promise<void> {
    refreshToken = null;
    await options.storage.removeItem(AUTH_KEY);
    await options.storage.removeItem(REFRESH_KEY);
    setState({ status: "loggedOut", token: null });
    options.onLogout?.();
  }

  async function runRefresh(): Promise<string | null> {
    await init();
    // Nothing to refresh when there is no session. Clearing here would wipe the
    // query cache and re-render every consumer for a request that never carried
    // a token, and each re-render would send it again.
    if (state.status !== "loggedIn") return null;
    if (!refreshToken) {
      await clear();
      return null;
    }

    const response = await graphqlRequest<RefreshTokenResponse>(
      options.endpoint,
      REFRESH_TOKEN_MUTATION,
      { input: { refresh_token: refreshToken } },
    );

    if (hasErrors(response) || !response.data) {
      // Only a rejected refresh token ends the session. A transient failure
      // must leave it intact, or a backend deploy signs out every client at
      // once when the next request would have succeeded.
      if (isUnauthorizedError(response)) {
        await clear();
        return null;
      }
      return state.token;
    }

    const { auth_token, refresh_token } = response.data.refreshToken.data;
    await persist(auth_token, refresh_token);
    return auth_token;
  }

  function init(): Promise<void> {
    ready ??= (async () => {
      try {
        const [auth, stored] = await Promise.all([
          options.storage.getItem(AUTH_KEY),
          options.storage.getItem(REFRESH_KEY),
        ]);
        refreshToken = stored;
        setState(
          auth
            ? { status: "loggedIn", token: auth }
            : { status: "loggedOut", token: null },
        );
      } catch {
        // An unreadable store (SecureStore on a locked device, a blocked
        // localStorage) must not leave the app on its spinner forever.
        refreshToken = null;
        setState({ status: "loggedOut", token: null });
      }
    })();
    return ready;
  }

  function refresh(): Promise<string | null> {
    // Single-flight: many hooks mounting together must produce one refresh, and
    // a rotated refresh token would make a second concurrent call fail anyway.
    inFlight ??= runRefresh().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    init,

    async getToken() {
      // Hooks mount and fire before the provider's init effect has run, so
      // the first request would otherwise go out with no token at all.
      await init();
      if (!state.token) return null;
      if (shouldRefreshToken(state.token)) return refresh();
      return state.token;
    },

    refresh,

    async login(email, password) {
      const response = await graphqlRequest<LoginResponse>(
        options.endpoint,
        LOGIN_MUTATION,
        {
          input: {
            email,
            password,
            ...(options.appId !== undefined ? { pylo_app_id: options.appId } : {}),
          },
        },
      );

      if (hasErrors(response)) {
        return {
          success: false,
          error: {
            code: "INVALID_CREDENTIALS",
            message: extractErrorMessage(response.errors) ?? "Login failed",
          },
        };
      }

      if (!response.data) {
        return {
          success: false,
          error: { code: "SERVER_ERROR", message: "No data returned" },
        };
      }

      const { auth_token, refresh_token } = response.data.login.data;
      await startSession(auth_token, refresh_token);

      return { success: true, authToken: auth_token, refreshToken: refresh_token };
    },

    async redeemHandoff(code, verifier) {
      // A slow init landing after persist would revert the new session to loggedOut.
      await init();
      let response: GraphQLResponse<LoginHandoffResponse>;
      try {
        response = await graphqlRequest<LoginHandoffResponse>(
          options.endpoint,
          REDEEM_LOGIN_HANDOFF_MUTATION,
          { input: { code, handoff_verifier: verifier } },
        );
      } catch (error) {
        return {
          success: false,
          error: {
            code: "LOGIN_FAILED",
            message: error instanceof Error ? error.message : "Login failed",
          },
        };
      }

      if (hasErrors(response) || !response.data) {
        return {
          success: false,
          error: {
            code: "LOGIN_FAILED",
            message: extractErrorMessage(response.errors) ?? "Login failed",
          },
        };
      }

      const { auth_token, refresh_token, redirect } = response.data.redeemLoginHandoff.data;
      await startSession(auth_token, refresh_token);
      const safe = safeRedirectPath(redirect);

      return {
        success: true,
        authToken: auth_token,
        refreshToken: refresh_token,
        ...(safe !== null ? { redirect: safe } : {}),
      };
    },

    logout: clear,
  };
}

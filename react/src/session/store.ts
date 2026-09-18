import {
  graphqlRequest,
  hasErrors,
  extractErrorMessage,
  isUnauthorizedError,
  shouldRefreshToken,
  LOGIN_MUTATION,
  REFRESH_TOKEN_MUTATION,
} from "@pylo/auth";
import type { AuthResult, LoginResponse, RefreshTokenResponse } from "@pylo/auth";
import type { PyloStorage } from "./storage.js";

export type SessionStatus = "loading" | "signedIn" | "signedOut";

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
  onSignOut?: () => void;
  /** Called after a successful login, not after a refresh. */
  onSignIn?: () => void;
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
    setState({ status: "signedIn", token: auth });
  }

  async function clear(): Promise<void> {
    refreshToken = null;
    await options.storage.removeItem(AUTH_KEY);
    await options.storage.removeItem(REFRESH_KEY);
    setState({ status: "signedOut", token: null });
    options.onSignOut?.();
  }

  async function runRefresh(): Promise<string | null> {
    await init();
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
            ? { status: "signedIn", token: auth }
            : { status: "signedOut", token: null },
        );
      } catch {
        // An unreadable store (SecureStore on a locked device, a blocked
        // localStorage) must not leave the app on its spinner forever.
        refreshToken = null;
        setState({ status: "signedOut", token: null });
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
      await persist(auth_token, refresh_token);
      options.onSignIn?.();

      return { success: true, authToken: auth_token, refreshToken: refresh_token };
    },

    logout: clear,
  };
}

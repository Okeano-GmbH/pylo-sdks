import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPyloClient, resolveEndpoint } from "@pylo/core";
import type { PyloClient } from "@pylo/core";
import { ME_QUERY } from "@pylo/auth";
import type {
  AuthResult,
  HandoffCrypto,
  MeResponse,
  PyloUser,
  SocialProvider,
} from "@pylo/auth";
import { createSessionStore } from "./session/store.js";
import type { SessionState, SessionStore } from "./session/store.js";
import { createSocialSignIn } from "./session/social.js";
import type { OpenAuthSession, SocialSignIn } from "./session/social.js";
import { createLocalStorageAdapter } from "./session/storage.js";
import type { PyloStorage } from "./session/storage.js";
import { createDirectTransport } from "./transport.js";
import type { Transport } from "./transport.js";

interface PyloContextValue {
  transport: Transport;
  endpoint: string;
  state: SessionState;
  store: SessionStore | null;
  social: SocialSignIn | null;
  getToken: () => Promise<string | null>;
}

const PyloContext = createContext<PyloContextValue | null>(null);

function usePyloContext(): PyloContextValue {
  const value = useContext(PyloContext);
  if (!value) {
    throw new Error("usePylo* must be used inside <PyloProvider>");
  }
  return value;
}

export interface PyloProviderProps {
  children: ReactNode;
  endpoint?: string;
  appId?: string;
  storage?: PyloStorage;
  keyPrefix?: string;
  /**
   * Escape hatch for apps whose auth lives elsewhere. Supplying it disables the
   * session entirely: no login, no logout, no refresh.
   */
  getToken?: () => Promise<string | null>;
  /**
   * Runs social sign-in in an in-app browser session instead of navigating the
   * page. Resolves with the URL the session ended on, or `null` when dismissed.
   */
  openAuthSession?: OpenAuthSession;
  handoffCrypto?: HandoffCrypto;
}

const SIGNED_OUT: SessionState = { status: "signedOut", token: null };
const NO_OP = () => () => {};

export function PyloProvider(props: PyloProviderProps) {
  const queryClient = useQueryClient();
  const endpoint = resolveEndpoint(props.endpoint);

  // One store for the provider's lifetime. Switching auth mode mid-flight is
  // not a supported transition, so nothing here reacts to prop changes.
  const storeRef = useRef<SessionStore | null>(null);
  const socialRef = useRef<SocialSignIn | null>(null);
  const openAuthSessionRef = useRef(props.openAuthSession);
  openAuthSessionRef.current = props.openAuthSession;
  if (storeRef.current === null && !props.getToken) {
    storeRef.current = createSessionStore({
      endpoint,
      storage: props.storage ?? createLocalStorageAdapter(),
      ...(props.appId !== undefined ? { appId: props.appId } : {}),
      ...(props.keyPrefix !== undefined ? { keyPrefix: props.keyPrefix } : {}),
      onSignOut: () => queryClient.clear(),
      onSignIn: () => void queryClient.invalidateQueries({ queryKey: ["pylo"] }),
    });
    if (props.appId !== undefined) {
      socialRef.current = createSocialSignIn({
        endpoint,
        appId: props.appId,
        keyPrefix: props.keyPrefix ?? "pylo",
        store: storeRef.current,
        ...(props.openAuthSession
          ? {
              openAuthSession: (url: string, returnUrl: string) =>
                openAuthSessionRef.current!(url, returnUrl),
            }
          : {}),
        ...(props.handoffCrypto ? { crypto: props.handoffCrypto } : {}),
      });
    }
  }
  const store = storeRef.current;
  const social = socialRef.current;

  const state = useSyncExternalStore(
    store ? store.subscribe : NO_OP,
    store ? store.getState : () => SIGNED_OUT,
    store ? store.getState : () => SIGNED_OUT,
  );

  useEffect(() => {
    void store?.init();
  }, [store]);

  // Callers commonly pass an inline closure for `getToken`, so it is read per
  // render rather than tracked: depending on it would rebuild the transport
  // every time and change every hook's identity with it.
  const getTokenProp = props.getToken;
  const getTokenRef = useRef(getTokenProp);
  getTokenRef.current = getTokenProp;
  const isEscapeHatch = getTokenProp !== undefined;

  const value = useMemo<PyloContextValue>(() => {
    const getToken = isEscapeHatch
      ? () => getTokenRef.current!()
      : () => store!.getToken();

    const transport = createDirectTransport({
      endpoint,
      getToken,
      ...(store ? { onUnauthorized: () => store.refresh() } : {}),
    });

    return { transport, endpoint, state, store, social, getToken };
  }, [endpoint, state, store, social, isEscapeHatch]);

  return <PyloContext.Provider value={value}>{props.children}</PyloContext.Provider>;
}

export function usePyloTransport(): Transport {
  return usePyloContext().transport;
}

export function usePyloClient<S>(): PyloClient<S> {
  const { endpoint, getToken } = usePyloContext();
  return useMemo(
    () =>
      createPyloClient<S>({
        endpoint,
        auth: async () => {
          const token = await getToken();
          return token !== null ? { token } : {};
        },
      }),
    [endpoint, getToken],
  );
}

export interface PyloAuth<P extends string = SocialProvider, U extends string = string>
  extends SocialSignIn<P, U> {
  isLoading: boolean;
  isSignedIn: boolean;
  user: PyloUser | undefined;
  login: (email: string, password: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
  getToken: () => Promise<string | null>;
}

export function usePyloAuth(): PyloAuth {
  const { state, store, social, transport, getToken } = usePyloContext();
  const isSignedIn = state.status === "signedIn";

  const me = useQuery({
    queryKey: ["pylo", "me"],
    queryFn: async () => {
      const data = (await transport(ME_QUERY, {})) as MeResponse;
      return data.me.current_user.data;
    },
    enabled: isSignedIn,
  });

  return {
    isLoading: state.status === "loading" || (isSignedIn && me.isLoading),
    isSignedIn,
    user: me.data,
    login: async (email, password) => {
      if (!store) {
        throw new Error("login is unavailable when PyloProvider is given getToken");
      }
      return store.login(email, password);
    },
    logout: async () => {
      if (!store) {
        throw new Error("logout is unavailable when PyloProvider is given getToken");
      }
      await store.logout();
    },
    signInWith: async (provider, options) =>
      requireSocial("signInWith").signInWith(provider, options),
    completeSignIn: async (url) => requireSocial("completeSignIn").completeSignIn(url),
    getToken,
  };

  function requireSocial(method: string): SocialSignIn {
    if (!store) {
      throw new Error(`${method} is unavailable when PyloProvider is given getToken`);
    }
    if (!social) throw new Error(`${method} requires PyloProvider's appId`);
    return social;
  }
}

import {
  buildSocialStartUrl,
  createHandoffChallenge,
  createHandoffVerifier,
  parseHandoffCallback,
} from "@pylo/auth";
import type { AuthResult, HandoffCrypto, SocialProvider } from "@pylo/auth";
import type { SessionStore } from "./store.js";

export type SocialLoginResult = AuthResult & { redirect?: string };

export type OpenAuthSession = (url: string, returnUrl: string) => Promise<string | null>;

export interface SocialLogin<P extends string = SocialProvider, U extends string = string> {
  /**
   * On the web this navigates away and never resolves; finish on the return page
   * with `completeLogin`. With `openAuthSession` it resolves once the session ends.
   */
  loginWith(
    provider: P,
    options: { returnUrl: U; redirect?: string; invite?: string },
  ): Promise<SocialLoginResult>;
  /** Finishes a web login from the return page's URL. */
  completeLogin(url?: string): Promise<SocialLoginResult>;
}

export interface SocialLoginOptions {
  endpoint: string;
  appId: string;
  keyPrefix: string;
  store: SessionStore;
  openAuthSession?: OpenAuthSession;
  crypto?: HandoffCrypto;
}

function failed(code: "LOGIN_FAILED" | "CANCELLED", message: string): SocialLoginResult {
  return { success: false, error: { code, message } };
}

export function createSocialLogin(o: SocialLoginOptions): SocialLogin {
  const verifierKey = `${o.keyPrefix}.handoff_verifier`;
  let completing: Promise<SocialLoginResult> | null = null;

  function redeem(
    parsed: ReturnType<typeof parseHandoffCallback>,
    verifier: string | null,
  ): Promise<SocialLoginResult> | SocialLoginResult {
    if (!parsed) return failed("LOGIN_FAILED", "No login response in this URL");
    if ("error" in parsed) return failed("LOGIN_FAILED", parsed.error);
    if (!verifier) {
      return failed("LOGIN_FAILED", "No login was started in this browser session");
    }
    return o.store.redeemHandoff(parsed.code, verifier);
  }

  async function finish(url: string): Promise<SocialLoginResult> {
    try {
      const verifier = sessionStorage.getItem(verifierKey);
      sessionStorage.removeItem(verifierKey);

      const parsed = parseHandoffCallback(url);
      if (parsed && url === location.href) {
        // A reload must not replay a spent, single-use code.
        const clean = new URL(url);
        clean.searchParams.delete("code");
        clean.searchParams.delete("error");
        history.replaceState(history.state, "", clean.toString());
      }

      return await redeem(parsed, verifier);
    } catch (error) {
      return failed("LOGIN_FAILED", error instanceof Error ? error.message : "Login failed");
    }
  }

  return {
    async loginWith(provider, { returnUrl, redirect, invite }) {
      let verifier: string;
      let startUrl: string;
      let finalUrl: string | null = null;
      try {
        verifier = await createHandoffVerifier(o.crypto);
        const challenge = await createHandoffChallenge(verifier, o.crypto);
        startUrl = buildSocialStartUrl({
          endpoint: o.endpoint,
          provider,
          appId: o.appId,
          returnUrl,
          challenge,
          ...(redirect !== undefined ? { redirect } : {}),
          ...(invite !== undefined ? { invite } : {}),
        });
        if (o.openAuthSession) finalUrl = await o.openAuthSession(startUrl, returnUrl);
      } catch (error) {
        return failed(
          "LOGIN_FAILED",
          error instanceof Error ? error.message : "Login failed",
        );
      }

      if (o.openAuthSession) {
        if (finalUrl === null) return failed("CANCELLED", "Login was cancelled");
        return redeem(parseHandoffCallback(finalUrl), verifier);
      }

      // The page unloads, so the verifier has to outlive this closure.
      sessionStorage.setItem(verifierKey, verifier);
      location.assign(startUrl);
      return new Promise<never>(() => {});
    },

    completeLogin(url) {
      if (o.openAuthSession) {
        return Promise.resolve(
          failed("LOGIN_FAILED", "loginWith already completes the login in this environment"),
        );
      }
      // StrictMode runs effects twice; a second call must share the first's single-use verifier.
      completing ??= finish(url ?? location.href).finally(() => {
        completing = null;
      });
      return completing;
    },
  };
}

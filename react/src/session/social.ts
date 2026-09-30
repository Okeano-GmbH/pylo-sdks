import {
  buildSocialStartUrl,
  createHandoffChallenge,
  createHandoffVerifier,
  parseHandoffCallback,
} from "@pylo/auth";
import type { AuthResult, HandoffCrypto, SocialProvider } from "@pylo/auth";
import type { SessionStore } from "./store.js";

export type SocialSignInResult = AuthResult & { redirect?: string };

export type OpenAuthSession = (url: string, returnUrl: string) => Promise<string | null>;

export interface SocialSignIn<P extends string = SocialProvider, U extends string = string> {
  /**
   * On the web this navigates away and never resolves; finish on the return page
   * with `completeSignIn`. With `openAuthSession` it resolves once the session ends.
   */
  signInWith(
    provider: P,
    options: { returnUrl: U; redirect?: string; invite?: string },
  ): Promise<SocialSignInResult>;
  /** Finishes a web sign-in from the return page's URL. */
  completeSignIn(url?: string): Promise<SocialSignInResult>;
}

export interface SocialSignInOptions {
  endpoint: string;
  appId: string;
  keyPrefix: string;
  store: SessionStore;
  openAuthSession?: OpenAuthSession;
  crypto?: HandoffCrypto;
}

function failed(code: "SIGN_IN_FAILED" | "CANCELLED", message: string): SocialSignInResult {
  return { success: false, error: { code, message } };
}

export function createSocialSignIn(o: SocialSignInOptions): SocialSignIn {
  const verifierKey = `${o.keyPrefix}.handoff_verifier`;
  let completing: Promise<SocialSignInResult> | null = null;

  function redeem(
    parsed: ReturnType<typeof parseHandoffCallback>,
    verifier: string | null,
  ): Promise<SocialSignInResult> | SocialSignInResult {
    if (!parsed) return failed("SIGN_IN_FAILED", "No sign-in response in this URL");
    if ("error" in parsed) return failed("SIGN_IN_FAILED", parsed.error);
    if (!verifier) {
      return failed("SIGN_IN_FAILED", "No sign-in was started in this browser session");
    }
    return o.store.redeemHandoff(parsed.code, verifier);
  }

  async function finish(url: string): Promise<SocialSignInResult> {
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
      return failed("SIGN_IN_FAILED", error instanceof Error ? error.message : "Sign-in failed");
    }
  }

  return {
    async signInWith(provider, { returnUrl, redirect, invite }) {
      let verifier: string;
      let startUrl: string;
      let finalUrl: string | null = null;
      try {
        verifier = createHandoffVerifier(o.crypto);
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
          "SIGN_IN_FAILED",
          error instanceof Error ? error.message : "Sign-in failed",
        );
      }

      if (o.openAuthSession) {
        if (finalUrl === null) return failed("CANCELLED", "Sign-in was cancelled");
        return redeem(parseHandoffCallback(finalUrl), verifier);
      }

      // The page unloads, so the verifier has to outlive this closure.
      sessionStorage.setItem(verifierKey, verifier);
      location.assign(startUrl);
      return new Promise<never>(() => {});
    },

    completeSignIn(url) {
      if (o.openAuthSession) {
        return Promise.resolve(
          failed("SIGN_IN_FAILED", "signInWith already completes the sign-in in this environment"),
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

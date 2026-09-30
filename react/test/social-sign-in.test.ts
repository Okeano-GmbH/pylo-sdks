import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHandoffChallenge, webHandoffCrypto } from "@pylo/auth";
import type { HandoffCrypto } from "@pylo/auth";
import { createSocialSignIn } from "../src/session/social.js";
import type { SessionStore } from "../src/session/store.js";

const VERIFIER_KEY = "pylo.handoff_verifier";

let session: Map<string, string>;
let assign: ReturnType<typeof vi.fn>;
let replaceState: ReturnType<typeof vi.fn>;
let redeemHandoff: ReturnType<typeof vi.fn>;

function setup(
  extra: {
    openAuthSession?: (url: string, returnUrl: string) => Promise<string | null>;
    crypto?: HandoffCrypto;
  } = {},
) {
  const store = { redeemHandoff } as unknown as SessionStore;
  return createSocialSignIn({
    endpoint: "https://api.test/graphql",
    appId: "app-1",
    keyPrefix: "pylo",
    store,
    ...extra,
  });
}

beforeEach(() => {
  session = new Map();
  assign = vi.fn();
  replaceState = vi.fn();
  redeemHandoff = vi.fn().mockResolvedValue({ success: true, redirect: "/x" });
  vi.stubGlobal("sessionStorage", {
    getItem: vi.fn((key: string) => session.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void session.set(key, value)),
    removeItem: vi.fn((key: string) => void session.delete(key)),
  });
  vi.stubGlobal("location", { href: "https://app/", assign });
  vi.stubGlobal("history", { state: null, replaceState });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signInWith on the web", () => {
  it("stores a verifier and navigates to the broker with its challenge", async () => {
    const social = setup();
    void social.signInWith("google", { returnUrl: "https://app/auth", redirect: "/x" });
    await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1));

    const verifier = session.get(VERIFIER_KEY);
    expect(verifier).toBeTruthy();
    const url = new URL(assign.mock.calls[0]?.[0] as string);
    expect(url.origin + url.pathname).toBe("https://api.test/auth/google/start");
    expect(url.searchParams.get("app_id")).toBe("app-1");
    expect(url.searchParams.get("return_url")).toBe("https://app/auth");
    expect(url.searchParams.get("redirect")).toBe("/x");
    expect(url.searchParams.get("handoff_challenge")).toBe(
      await createHandoffChallenge(verifier!),
    );
  });
});

describe("completeSignIn", () => {
  it("redeems the code with the stored verifier and cleans up", async () => {
    session.set(VERIFIER_KEY, "v1");
    vi.stubGlobal("location", { href: "https://app/auth?code=c", assign });
    const social = setup();

    const result = await social.completeSignIn("https://app/auth?code=c");

    expect(redeemHandoff).toHaveBeenCalledWith("c", "v1");
    expect(result).toEqual({ success: true, redirect: "/x" });
    expect(session.has(VERIFIER_KEY)).toBe(false);
    expect(replaceState).toHaveBeenCalledWith(null, "", "https://app/auth");
  });

  it("defaults to the current location", async () => {
    session.set(VERIFIER_KEY, "v1");
    vi.stubGlobal("location", { href: "https://app/auth?code=c&tab=1", assign });

    await setup().completeSignIn();

    expect(redeemHandoff).toHaveBeenCalledWith("c", "v1");
    expect(replaceState).toHaveBeenCalledWith(null, "", "https://app/auth?tab=1");
  });

  it("fails without calling the API when the URL has no response", async () => {
    session.set(VERIFIER_KEY, "v1");

    const result = await setup().completeSignIn("https://app/auth");

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("SIGN_IN_FAILED");
    expect(redeemHandoff).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("reports the broker's error", async () => {
    session.set(VERIFIER_KEY, "v1");
    vi.stubGlobal("location", { href: "https://app/auth?error=Login%20failed", assign });

    const result = await setup().completeSignIn("https://app/auth?error=Login%20failed");

    expect(result).toEqual({
      success: false,
      error: { code: "SIGN_IN_FAILED", message: "Login failed" },
    });
    expect(redeemHandoff).not.toHaveBeenCalled();
    expect(session.has(VERIFIER_KEY)).toBe(false);
    expect(replaceState).toHaveBeenCalledWith(null, "", "https://app/auth");
  });

  it("fails without calling the API when no verifier is stored", async () => {
    const result = await setup().completeSignIn("https://app/auth?code=c");

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("SIGN_IN_FAILED");
    expect(redeemHandoff).not.toHaveBeenCalled();
  });
});

describe("completeSignIn robustness", () => {
  const onReturnPage = (href: string) => {
    const loc = { href, assign };
    vi.stubGlobal("location", loc);
    replaceState.mockImplementation((_state: unknown, _title: string, url: string) => {
      loc.href = url;
    });
  };

  it("redeems once when called twice concurrently", async () => {
    session.set(VERIFIER_KEY, "v1");
    onReturnPage("https://app/auth?code=c");
    const social = setup();

    const first = social.completeSignIn();
    const second = social.completeSignIn();

    expect(await second).toBe(await first);
    expect(redeemHandoff).toHaveBeenCalledTimes(1);
    expect(await first).toEqual({ success: true, redirect: "/x" });
  });

  it("finds no response once an earlier call has settled", async () => {
    session.set(VERIFIER_KEY, "v1");
    onReturnPage("https://app/auth?code=c");
    const social = setup();
    await social.completeSignIn();

    const result = await social.completeSignIn();

    expect(result).toEqual({
      success: false,
      error: { code: "SIGN_IN_FAILED", message: "No sign-in response in this URL" },
    });
    expect(redeemHandoff).toHaveBeenCalledTimes(1);
  });

  it("resolves a failure when the redeem rejects", async () => {
    session.set(VERIFIER_KEY, "v1");
    redeemHandoff.mockRejectedValue(new Error("boom"));

    const result = await setup().completeSignIn("https://app/auth?code=c");

    expect(result).toEqual({ success: false, error: { code: "SIGN_IN_FAILED", message: "boom" } });
  });

  it("does not rewrite the address bar for a URL other than the current one", async () => {
    session.set(VERIFIER_KEY, "v1");
    vi.stubGlobal("location", { href: "https://app/elsewhere", assign });

    const result = await setup().completeSignIn("https://app/auth?code=c");

    expect(result.success).toBe(true);
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("fails without touching storage or history when an auth session is configured", async () => {
    const social = setup({ openAuthSession: vi.fn() });

    const result = await social.completeSignIn("myapp://auth?code=c");

    expect(result).toEqual({
      success: false,
      error: {
        code: "SIGN_IN_FAILED",
        message: "signInWith already completes the sign-in in this environment",
      },
    });
    expect(sessionStorage.getItem).not.toHaveBeenCalled();
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(redeemHandoff).not.toHaveBeenCalled();
  });
});

describe("signInWith through an auth session", () => {
  it("reports a dismissed session as cancelled", async () => {
    const social = setup({ openAuthSession: async () => null });

    const result = await social.signInWith("google", { returnUrl: "myapp://auth" });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("CANCELLED");
    expect(redeemHandoff).not.toHaveBeenCalled();
  });

  it("resolves a failed session instead of rejecting", async () => {
    const social = setup({
      openAuthSession: async () => {
        throw new Error("Another session is already open");
      },
    });

    const result = await social.signInWith("microsoft", { returnUrl: "myapp://auth" });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("SIGN_IN_FAILED");
  });

  it("resolves a failure when the challenge cannot be computed", async () => {
    const social = setup({
      openAuthSession: vi.fn(),
      crypto: {
        ...webHandoffCrypto,
        sha256: async () => {
          throw new Error("SHA-256 unavailable");
        },
      },
    });

    const result = await social.signInWith("google", { returnUrl: "myapp://auth" });

    expect(result).toEqual({
      success: false,
      error: { code: "SIGN_IN_FAILED", message: "SHA-256 unavailable" },
    });
  });

  it("redeems with the verifier behind the challenge it sent", async () => {
    const openAuthSession = vi.fn(async () => "myapp://auth?code=c");
    const social = setup({ openAuthSession });

    const result = await social.signInWith("google", { returnUrl: "myapp://auth" });

    expect(result).toEqual({ success: true, redirect: "/x" });
    const [startUrl, returnUrl] = openAuthSession.mock.calls[0] as unknown as [string, string];
    expect(returnUrl).toBe("myapp://auth");
    const verifier = redeemHandoff.mock.calls[0]?.[1] as string;
    expect(redeemHandoff.mock.calls[0]?.[0]).toBe("c");
    expect(new URL(startUrl).searchParams.get("handoff_challenge")).toBe(
      await createHandoffChallenge(verifier),
    );
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.getItem).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});

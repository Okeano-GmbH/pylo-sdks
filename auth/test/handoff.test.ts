import { describe, it, expect } from "vitest";
import {
  buildSocialStartUrl,
  createHandoffChallenge,
  createHandoffVerifier,
  parseHandoffCallback,
  safeRedirectPath,
} from "../src/index.js";

describe("handoff", () => {
  it("derives the RFC 7636 S256 challenge", async () => {
    expect(await createHandoffChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("makes a 43-char base64url verifier", () => {
    expect(createHandoffVerifier()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("builds the start URL on the endpoint's origin", () => {
    const url = new URL(
      buildSocialStartUrl({
        endpoint: "https://api.test/graphql",
        provider: "microsoft",
        appId: "a1",
        returnUrl: "myapp://auth",
        challenge: "c",
        redirect: "/x?y=1",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://api.test/auth/microsoft/start");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      app_id: "a1",
      return_url: "myapp://auth",
      handoff_challenge: "c",
      redirect: "/x?y=1",
    });
  });

  it("adds the invite and leaves out an omitted redirect", () => {
    const url = new URL(
      buildSocialStartUrl({
        endpoint: "https://api.test/graphql",
        provider: "google",
        appId: "a1",
        returnUrl: "https://app/auth",
        challenge: "c",
        invite: "inv-1",
      }),
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      app_id: "a1",
      return_url: "https://app/auth",
      handoff_challenge: "c",
      invite: "inv-1",
    });
    expect(url.searchParams.has("redirect")).toBe(false);
  });

  it.each([
    ["https://app/auth?code=k", { code: "k" }],
    ["https://app/auth?tab=x&code=k", { code: "k" }],
    ["myapp://auth?error=Login%20failed", { error: "Login failed" }],
    ["https://app/auth?code=k&error=denied", { error: "denied" }],
    ["https://app/auth", null],
  ])("parses %s", (url, expected) => expect(parseHandoffCallback(url)).toEqual(expected));

  it.each(["/dash?x=1#h"])("keeps %s", (p) => expect(safeRedirectPath(p)).toBe(p));

  it.each(["//evil.com", "/.//evil.com", "/a/..//evil.com", "/%2e//evil.com", "/\\evil.com", "/\t/evil.com", "https://evil.com", "javascript:alert(1)", "dash", "", null])(
    "rejects %s",
    (p) => expect(safeRedirectPath(p)).toBeNull(),
  );
});

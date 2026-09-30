import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server.js";

const graphqlRequest = vi.fn();
const jar = new Map<string, string>();
const del = vi.fn((_arg: unknown) => {});
const set = vi.fn((name: string, value: string, _opts?: Record<string, unknown>) => {
  jar.set(name, value);
});

vi.mock("next/headers.js", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set,
    delete: (arg: string | { name: string }) => {
      del(arg);
      jar.delete(typeof arg === "string" ? arg : arg.name);
    },
  }),
  headers: async () => new Headers(),
}));

vi.mock("@pylo/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pylo/auth")>();
  return { ...actual, graphqlRequest };
});

const { createSocialStartRoute, createSocialCallbackRoute } = await import("../src/social.js");
const { createHandoffChallenge, REDEEM_LOGIN_HANDOFF_MUTATION } = await import("@pylo/auth");

const VERIFIER_COOKIE = "pylo_handoff_verifier_app1";

beforeEach(() => {
  graphqlRequest.mockReset();
  set.mockClear();
  del.mockClear();
  jar.clear();
  process.env.PYLO_APP_ID = "app1";
  process.env.PYLO_APP_URL = "https://app.test";
  process.env.PYLO_GRAPHQL_ENDPOINT = "https://api.test/graphql";
});

const start = (provider: string, query = "") =>
  createSocialStartRoute()(new NextRequest(`https://app.test/api/auth/${provider}/start${query}`), {
    params: Promise.resolve({ provider }),
  });

const callback = (query: string, loginPath?: string) =>
  createSocialCallbackRoute(loginPath ? { loginPath } : {})(
    new NextRequest(`https://app.test/api/auth/callback${query}`),
  );

const expectVerifierDeletedAtCallbackPath = () =>
  expect(del).toHaveBeenCalledWith({ name: VERIFIER_COOKIE, path: "/api/auth/callback" });

describe("social start route", () => {
  it("redirects to the broker with a challenge bound to the cookie verifier", async () => {
    const res = await start("google", "?redirect=/dash");
    expect(res.status).toBe(302);
    const target = new URL(res.headers.get("location")!);
    expect(target.origin + target.pathname).toBe("https://api.test/auth/google/start");
    expect(target.searchParams.get("app_id")).toBe("app1");
    expect(target.searchParams.get("return_url")).toBe("https://app.test/api/auth/callback");
    expect(target.searchParams.get("redirect")).toBe("/dash");

    const verifier = jar.get(VERIFIER_COOKIE)!;
    expect(target.searchParams.get("handoff_challenge")).toBe(await createHandoffChallenge(verifier));
    expect(set).toHaveBeenCalledWith(
      VERIFIER_COOKIE,
      verifier,
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        path: "/api/auth/callback",
        maxAge: 600,
      }),
    );
  });

  it("accepts plain-object params (Next 14)", async () => {
    const res = await createSocialStartRoute()(new NextRequest("https://app.test/x"), {
      params: { provider: "microsoft" },
    });
    expect(new URL(res.headers.get("location")!).pathname).toBe("/auth/microsoft/start");
  });

  it("returns 404 for an unknown provider", async () => {
    const res = await start("github");
    expect(res.status).toBe(404);
    expect(set).not.toHaveBeenCalled();
  });

  it("throws without a return URL", async () => {
    delete process.env.PYLO_APP_URL;
    await expect(start("google")).rejects.toThrow();
  });
});

describe("social callback route", () => {
  const redeemed = (redirect: string | null) => ({
    data: { redeemLoginHandoff: { data: { auth_token: "at", refresh_token: "rt", redirect } } },
  });

  it("redeems the code, sets auth cookies, clears the verifier and redirects", async () => {
    jar.set(VERIFIER_COOKIE, "ver");
    graphqlRequest.mockResolvedValue(redeemed("/dash"));
    const res = await callback("?code=abc");
    expect(graphqlRequest).toHaveBeenCalledWith(
      "https://api.test/graphql",
      REDEEM_LOGIN_HANDOFF_MUTATION,
      { input: { code: "abc", handoff_verifier: "ver" } },
    );
    expect(jar.get("pylo_auth_token_app1")).toBe("at");
    expect(jar.get("pylo_refresh_token_app1")).toBe("rt");
    expect(jar.has(VERIFIER_COOKIE)).toBe(false);
    expectVerifierDeletedAtCallbackPath();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://app.test/dash");
  });

  it("falls back to / for an unsafe redirect", async () => {
    jar.set(VERIFIER_COOKIE, "ver");
    graphqlRequest.mockResolvedValue(redeemed("//evil.com"));
    const res = await callback("?code=abc");
    expect(res.headers.get("location")).toBe("https://app.test/");
  });

  it("forwards a provider error to the login page without calling the API", async () => {
    jar.set(VERIFIER_COOKIE, "ver");
    const res = await callback("?error=Login+failed");
    expect(graphqlRequest).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://app.test/auth/login?error=Login+failed");
    expect(jar.has(VERIFIER_COOKIE)).toBe(false);
    expectVerifierDeletedAtCallbackPath();
  });

  it("errors without calling the API when the verifier cookie is missing", async () => {
    const res = await callback("?code=abc");
    expect(graphqlRequest).not.toHaveBeenCalled();
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/auth/login");
    expect(res.headers.get("location")).toContain("error=");
    expectVerifierDeletedAtCallbackPath();
  });

  it("keeps an existing query string on loginPath", async () => {
    const res = await callback("?error=Nope", "/login?tab=x");
    expect(res.headers.get("location")).toBe("https://app.test/login?tab=x&error=Nope");
  });

  it.each([
    ["graphql errors", () => graphqlRequest.mockResolvedValue({ errors: [{ message: "bad code" }] })],
    ["no data", () => graphqlRequest.mockResolvedValue({})],
    ["a thrown fetch", () => graphqlRequest.mockRejectedValue(new Error("network"))],
  ])("redirects to login on redeem failure: %s", async (_name, arrange) => {
    jar.set(VERIFIER_COOKIE, "ver");
    arrange();
    const res = await callback("?code=abc");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/auth/login?error=");
    expect(jar.has(VERIFIER_COOKIE)).toBe(false);
    expectVerifierDeletedAtCallbackPath();
    expect(jar.has("pylo_auth_token_app1")).toBe(false);
  });
});

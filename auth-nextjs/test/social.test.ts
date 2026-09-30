import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server.js";

const graphqlRequest = vi.fn();
const headerCookies = vi.fn();

vi.mock("next/headers.js", () => ({
  cookies: async () => {
    headerCookies();
    return { get: () => undefined, set: () => {}, delete: () => {} };
  },
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
  headerCookies.mockClear();
  process.env.PYLO_APP_ID = "app1";
  process.env.PYLO_GRAPHQL_ENDPOINT = "https://api.test/graphql";
});

const start = (provider: string, query = "", options?: { returnUrl?: string }) =>
  createSocialStartRoute(options)(
    new NextRequest(`https://app.test/api/auth/${provider}/start${query}`),
    { params: Promise.resolve({ provider }) },
  );

const callback = (
  query: string,
  { loginPath, verifier, path = "/api/auth/callback" }: {
    loginPath?: string;
    verifier?: string;
    path?: string;
  } = {},
) =>
  createSocialCallbackRoute(loginPath ? { loginPath } : {})(
    new NextRequest(`https://app.test${path}${query}`, {
      headers: verifier ? { cookie: `${VERIFIER_COOKIE}=${verifier}` } : {},
    }),
  );

const setCookie = (res: Response, name: string) =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));

const expectVerifierDeleted = (res: Response, path = "/api/auth/callback") => {
  const cookie = setCookie(res, VERIFIER_COOKIE);
  expect(cookie).toMatch(new RegExp(`^${VERIFIER_COOKIE}=;`));
  expect(cookie).toContain(`Path=${path}`);
  expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970/);
};

describe("social start route", () => {
  it("redirects to the broker with a challenge bound to the cookie verifier", async () => {
    const res = await start("google", "?redirect=/dash");
    expect(res.status).toBe(302);
    const target = new URL(res.headers.get("location")!);
    expect(target.origin + target.pathname).toBe("https://api.test/auth/google/start");
    expect(target.searchParams.get("app_id")).toBe("app1");
    expect(target.searchParams.get("return_url")).toBe("https://app.test/api/auth/callback");
    expect(target.searchParams.get("redirect")).toBe("/dash");

    const cookie = res.cookies.get(VERIFIER_COOKIE)!;
    expect(target.searchParams.get("handoff_challenge")).toBe(
      await createHandoffChallenge(cookie.value),
    );
    expect(cookie).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/api/auth/callback",
      maxAge: 600,
    });
    expect(headerCookies).not.toHaveBeenCalled();
  });

  it("scopes the verifier cookie to a custom returnUrl's path", async () => {
    const res = await start("google", "", { returnUrl: "https://app.test/auth/done" });
    expect(new URL(res.headers.get("location")!).searchParams.get("return_url")).toBe(
      "https://app.test/auth/done",
    );
    expect(res.cookies.get(VERIFIER_COOKIE)?.path).toBe("/auth/done");
  });

  it("builds the return URL from the forwarded host and protocol", async () => {
    const res = await createSocialStartRoute()(
      new NextRequest("http://0.0.0.0:3009/api/auth/google/start", {
        headers: { "x-forwarded-host": "app.example.com, proxy.internal", "x-forwarded-proto": "https" },
      }),
      { params: Promise.resolve({ provider: "google" }) },
    );
    expect(new URL(res.headers.get("location")!).searchParams.get("return_url")).toBe(
      "https://app.example.com/api/auth/callback",
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
    expect(res.headers.getSetCookie()).toEqual([]);
  });

});

describe("social callback route", () => {
  const redeemed = (redirect: string | null) => ({
    data: { redeemLoginHandoff: { data: { auth_token: "at", refresh_token: "rt", redirect } } },
  });

  it("redeems the code, sets auth cookies on the response, clears the verifier and redirects", async () => {
    graphqlRequest.mockResolvedValue(redeemed("/dash"));
    const res = await callback("?code=abc", { verifier: "ver" });
    expect(graphqlRequest).toHaveBeenCalledWith(
      "https://api.test/graphql",
      REDEEM_LOGIN_HANDOFF_MUTATION,
      { input: { code: "abc", handoff_verifier: "ver" } },
    );
    const base = { httpOnly: true, secure: false, sameSite: "lax", path: "/" };
    expect(res.cookies.get("pylo_auth_token_app1")).toMatchObject({
      ...base,
      value: "at",
      maxAge: 60 * 60,
    });
    expect(res.cookies.get("pylo_refresh_token_app1")).toMatchObject({
      ...base,
      value: "rt",
      maxAge: 60 * 60 * 24 * 7,
    });
    expectVerifierDeleted(res);
    expect(headerCookies).not.toHaveBeenCalled();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://app.test/dash");
  });

  it("deletes the verifier at the callback's own path", async () => {
    graphqlRequest.mockResolvedValue(redeemed(null));
    const res = await callback("?code=abc", { verifier: "ver", path: "/auth/done" });
    expectVerifierDeleted(res, "/auth/done");
  });

  it("falls back to / for an unsafe redirect", async () => {
    graphqlRequest.mockResolvedValue(redeemed("//evil.com"));
    const res = await callback("?code=abc", { verifier: "ver" });
    expect(res.headers.get("location")).toBe("https://app.test/");
  });

  it("forwards a provider error to the login page without calling the API", async () => {
    const res = await callback("?error=Login+failed", { verifier: "ver" });
    expect(graphqlRequest).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://app.test/auth/login?error=Login+failed");
    expectVerifierDeleted(res);
  });

  it("errors without calling the API when the verifier cookie is missing", async () => {
    const res = await callback("?code=abc");
    expect(graphqlRequest).not.toHaveBeenCalled();
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/auth/login");
    expect(res.headers.get("location")).toContain("error=");
    expectVerifierDeleted(res);
  });

  it("redirects to the forwarded host, not the host the server is bound to", async () => {
    graphqlRequest.mockResolvedValue(redeemed("/dash"));
    const res = await createSocialCallbackRoute()(
      new NextRequest("http://0.0.0.0:3009/api/auth/callback?code=abc", {
        headers: {
          cookie: `${VERIFIER_COOKIE}=ver`,
          "x-forwarded-host": "app.example.com",
          "x-forwarded-proto": "https",
        },
      }),
    );
    expect(res.headers.get("location")).toBe("https://app.example.com/dash");
  });

  it("keeps an existing query string on loginPath", async () => {
    const res = await callback("?error=Nope", { loginPath: "/login?tab=x" });
    expect(res.headers.get("location")).toBe("https://app.test/login?tab=x&error=Nope");
  });

  it.each([
    ["graphql errors", () => graphqlRequest.mockResolvedValue({ errors: [{ message: "bad code" }] })],
    ["no data", () => graphqlRequest.mockResolvedValue({})],
    ["a thrown fetch", () => graphqlRequest.mockRejectedValue(new Error("network"))],
  ])("redirects to login on redeem failure: %s", async (_name, arrange) => {
    arrange();
    const res = await callback("?code=abc", { verifier: "ver" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/auth/login?error=");
    expectVerifierDeleted(res);
    expect(setCookie(res, "pylo_auth_token_app1")).toBeUndefined();
  });
});

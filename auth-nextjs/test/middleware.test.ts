import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server.js";

vi.mock("next/headers.js", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

const { pyloAuth, createPyloProxy } = await import("../src/middleware.js");

const AUTH_COOKIE = "pylo_auth_token_app1";
const REFRESH_COOKIE = "pylo_refresh_token_app1";

const fetchMock = vi.fn<typeof fetch>();

const jwt = (exp: number) =>
  `h.${btoa(JSON.stringify({ sub: "u1", iat: exp - 3600, exp }))}.s`;
const now = () => Math.floor(Date.now() / 1000);

function pyloAnswers(status: number, body: unknown) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function request(
  path: string,
  { auth, refresh, headers = {} }: { auth?: string; refresh?: string; headers?: Record<string, string> } = {},
) {
  const cookie = [
    auth && `${AUTH_COOKIE}=${auth}`,
    refresh && `${REFRESH_COOKIE}=${refresh}`,
  ].filter(Boolean).join("; ");
  return new NextRequest(`https://app.test${path}`, {
    headers: { ...headers, ...(cookie ? { cookie } : {}) },
  });
}

// What a route handler behind the middleware will see for `name`.
const forwarded = (response: Response, name: string) => {
  const overridden = response.headers.get("x-middleware-override-headers")?.split(",") ?? [];
  return overridden.includes(name) ? response.headers.get(`x-middleware-request-${name}`) : null;
};

const cleared = (response: Response, name: string) =>
  response.headers.getSetCookie().some((c) => c.startsWith(`${name}=;`));

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.PYLO_APP_ID = "app1";
  process.env.PYLO_GRAPHQL_ENDPOINT = "https://api.test/graphql";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("pyloAuth refresh", () => {
  const expired = () => request("/dashboard", { auth: jwt(now() - 60), refresh: "r1" });

  it("ends the session when Pylo answers 401, whatever the error code", async () => {
    pyloAnswers(401, {
      data: null,
      errors: [{ message: "JWT decoding failed", extensions: { code: "INTERNAL_SERVER_ERROR" } }],
    });

    const auth = await pyloAuth(expired());

    expect(auth.loggedIn).toBe(false);
    expect(cleared(auth.response, AUTH_COOKIE)).toBe(true);
    expect(cleared(auth.response, REFRESH_COOKIE)).toBe(true);
    expect(forwarded(auth.response, "x-pylo-auth-failed")).toBe("true");
  });

  it("ends the session on a 401 UNAUTHENTICATED", async () => {
    pyloAnswers(401, {
      data: null,
      errors: [{ message: "Refresh token expired", extensions: { code: "UNAUTHENTICATED" } }],
    });

    const auth = await pyloAuth(expired());

    expect(auth.loggedIn).toBe(false);
    expect(cleared(auth.response, REFRESH_COOKIE)).toBe(true);
  });

  it("keeps the session on a 503", async () => {
    pyloAnswers(503, {
      errors: [{ message: "Service unavailable", extensions: { code: "INTERNAL_SERVER_ERROR" } }],
    });

    const auth = await pyloAuth(expired());

    expect(auth.loggedIn).toBe(true);
    expect(cleared(auth.response, REFRESH_COOKIE)).toBe(false);
    expect(forwarded(auth.response, "x-pylo-auth-refresh-failed")).toBe("true");
  });

  it("keeps the session when the request never reaches Pylo", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const auth = await pyloAuth(expired());

    expect(auth.loggedIn).toBe(true);
    expect(cleared(auth.response, REFRESH_COOKIE)).toBe(false);
  });
});

describe("internal headers", () => {
  const forged = {
    "x-pylo-auth-token": "attacker-token",
    "x-pylo-auth-failed": "true",
    "x-pylo-auth-refresh-failed": "true",
  };

  it("drops client-sent copies on a valid session", async () => {
    const auth = await pyloAuth(
      request("/dashboard", { auth: jwt(now() + 3600), headers: forged }),
    );

    expect(auth.loggedIn).toBe(true);
    for (const name of Object.keys(forged)) {
      expect(forwarded(auth.response, name)).toBeNull();
    }
    expect(auth.response.headers.get("x-middleware-override-headers")).not.toBeNull();
  });

  it("drops client-sent copies without a session", async () => {
    const auth = await pyloAuth(request("/api/graphql", { headers: forged }));

    expect(forwarded(auth.response, "x-pylo-auth-token")).toBeNull();
    expect(auth.response.headers.get("x-middleware-override-headers")).not.toBeNull();
  });

  it("replaces a client-sent token with the refreshed one", async () => {
    pyloAnswers(200, {
      data: { refreshToken: { data: { auth_token: "fresh", refresh_token: "r2" } } },
    });

    const auth = await pyloAuth(
      request("/dashboard", { auth: jwt(now() - 60), refresh: "r1", headers: forged }),
    );

    expect(forwarded(auth.response, "x-pylo-auth-token")).toBe("fresh");
    expect(forwarded(auth.response, "x-pylo-auth-failed")).toBeNull();
  });

  it("drops client-sent copies on public paths", async () => {
    const response = await createPyloProxy()(request("/auth/login", { headers: forged }));

    expect(forwarded(response, "x-pylo-auth-token")).toBeNull();
    expect(response.headers.get("x-middleware-override-headers")).not.toBeNull();
  });
});

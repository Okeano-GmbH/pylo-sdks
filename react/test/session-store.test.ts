import { describe, it, expect, vi, beforeEach } from "vitest";

const graphqlRequest = vi.fn();

vi.mock("@pylo/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pylo/auth")>();
  return { ...actual, graphqlRequest };
});

const { createSessionStore } = await import("../src/session/store.js");
const { createMemoryStorage } = await import("../src/session/storage.js");

function makeToken(payload: Record<string, unknown>): string {
  const b64 = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, "");
  return `${b64({ alg: "none" })}.${b64(payload)}.sig`;
}

// exp far out, iat now — `shouldRefreshToken` leaves this alone.
const fresh = (): string => {
  const now = Math.floor(Date.now() / 1000);
  return makeToken({ sub: "u1", iat: now, exp: now + 3600 });
};

// 90% of its lifetime elapsed — past the default 0.75 threshold.
const stale = (): string => {
  const now = Math.floor(Date.now() / 1000);
  return makeToken({ sub: "u1", iat: now - 900, exp: now + 100 });
};

const options = () => ({
  endpoint: "https://api.test/graphql",
  storage: createMemoryStorage(),
});

beforeEach(() => {
  graphqlRequest.mockReset();
});

describe("init", () => {
  it("starts loading and settles signed out with no stored token", async () => {
    const store = createSessionStore(options());
    expect(store.getState().status).toBe("loading");
    await store.init();
    expect(store.getState()).toEqual({ status: "signedOut", token: null });
  });

  it("settles signed in when storage holds a token", async () => {
    const storage = createMemoryStorage();
    const token = fresh();
    await storage.setItem("pylo.auth_token", token);
    await storage.setItem("pylo.refresh_token", "r1");

    const store = createSessionStore({ ...options(), storage });
    await store.init();

    expect(store.getState()).toEqual({ status: "signedIn", token });
  });

  it("namespaces its keys with the configured prefix", async () => {
    const storage = createMemoryStorage();
    const token = fresh();
    await storage.setItem("tenant-a.auth_token", token);

    const store = createSessionStore({ ...options(), storage, keyPrefix: "tenant-a" });
    await store.init();

    expect(store.getState().token).toBe(token);
  });

  it("settles signed out when storage cannot be read", async () => {
    const storage = createMemoryStorage();
    storage.getItem = async () => {
      throw new Error("keystore locked");
    };

    const store = createSessionStore({ ...options(), storage });
    await store.init();

    expect(store.getState()).toEqual({ status: "signedOut", token: null });
  });

  it("reads storage once however often it is called", async () => {
    const storage = createMemoryStorage();
    const getItem = vi.spyOn(storage, "getItem");

    const store = createSessionStore({ ...options(), storage });
    await Promise.all([store.init(), store.init()]);
    await store.init();

    expect(getItem).toHaveBeenCalledTimes(2);
  });
});

describe("login", () => {
  it("stores both tokens and signs in", async () => {
    const token = fresh();
    graphqlRequest.mockResolvedValue({
      data: { login: { data: { auth_token: token, refresh_token: "r1" } } },
    });

    const storage = createMemoryStorage();
    const store = createSessionStore({ ...options(), storage });
    await store.init();

    const result = await store.login("a@b.c", "pw");

    expect(result.success).toBe(true);
    expect(store.getState()).toEqual({ status: "signedIn", token });
    expect(await storage.getItem("pylo.refresh_token")).toBe("r1");
  });

  it("notifies onSignIn after a login but not after a refresh", async () => {
    const onSignIn = vi.fn();
    graphqlRequest.mockResolvedValue({
      data: { login: { data: { auth_token: stale(), refresh_token: "r1" } } },
    });

    const store = createSessionStore({ ...options(), onSignIn });
    await store.login("a@b.c", "pw");
    expect(onSignIn).toHaveBeenCalledTimes(1);

    graphqlRequest.mockResolvedValue({
      data: { refreshToken: { data: { auth_token: fresh(), refresh_token: "r2" } } },
    });
    await store.getToken();
    expect(graphqlRequest).toHaveBeenCalledTimes(2);
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("reports failure without signing in", async () => {
    graphqlRequest.mockResolvedValue({
      errors: [{ message: "Bad credentials", extensions: { code: "UNAUTHENTICATED" } }],
    });

    const store = createSessionStore(options());
    await store.init();
    const result = await store.login("a@b.c", "wrong");

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("INVALID_CREDENTIALS");
    expect(store.getState().status).toBe("signedOut");
  });

  it("sends the app id when one is configured", async () => {
    graphqlRequest.mockResolvedValue({
      data: { login: { data: { auth_token: fresh(), refresh_token: "r1" } } },
    });

    const store = createSessionStore({ ...options(), appId: "app-1" });
    await store.init();
    await store.login("a@b.c", "pw");

    expect(graphqlRequest.mock.calls[0]?.[2]).toEqual({
      input: { email: "a@b.c", password: "pw", pylo_app_id: "app-1" },
    });
  });

  it("omits the app id when none is configured", async () => {
    graphqlRequest.mockResolvedValue({
      data: { login: { data: { auth_token: fresh(), refresh_token: "r1" } } },
    });

    const store = createSessionStore(options());
    await store.init();
    await store.login("a@b.c", "pw");

    expect(graphqlRequest.mock.calls[0]?.[2]).toEqual({
      input: { email: "a@b.c", password: "pw" },
    });
  });
});

describe("getToken", () => {
  it("refreshes a token that is past its threshold", async () => {
    const storage = createMemoryStorage();
    await storage.setItem("pylo.auth_token", stale());
    await storage.setItem("pylo.refresh_token", "r1");

    const rotated = fresh();
    graphqlRequest.mockResolvedValue({
      data: { refreshToken: { data: { auth_token: rotated, refresh_token: "r2" } } },
    });

    const store = createSessionStore({ ...options(), storage });
    await store.init();

    expect(await store.getToken()).toBe(rotated);
    expect(await storage.getItem("pylo.refresh_token")).toBe("r2");
  });

  it("issues one refresh for concurrent callers", async () => {
    const storage = createMemoryStorage();
    await storage.setItem("pylo.auth_token", stale());
    await storage.setItem("pylo.refresh_token", "r1");

    graphqlRequest.mockResolvedValue({
      data: { refreshToken: { data: { auth_token: fresh(), refresh_token: "r2" } } },
    });

    const store = createSessionStore({ ...options(), storage });
    await store.init();

    await Promise.all([store.getToken(), store.getToken(), store.getToken()]);

    expect(graphqlRequest).toHaveBeenCalledTimes(1);
  });

  it("leaves a fresh token alone", async () => {
    const storage = createMemoryStorage();
    const token = fresh();
    await storage.setItem("pylo.auth_token", token);
    await storage.setItem("pylo.refresh_token", "r1");

    const store = createSessionStore({ ...options(), storage });
    await store.init();

    expect(await store.getToken()).toBe(token);
    expect(graphqlRequest).not.toHaveBeenCalled();
  });

  it("waits for init before answering", async () => {
    const storage = createMemoryStorage();
    const token = fresh();
    await storage.setItem("pylo.auth_token", token);

    // No explicit init: a hook mounting before the provider's effect.
    const store = createSessionStore({ ...options(), storage });
    expect(store.getState().status).toBe("loading");

    await expect(store.getToken()).resolves.toBe(token);
    expect(store.getState().status).toBe("signedIn");
  });

  it("returns null when there is no session", async () => {
    const store = createSessionStore(options());
    await store.init();
    expect(await store.getToken()).toBeNull();
    expect(graphqlRequest).not.toHaveBeenCalled();
  });
});

describe("refresh failure", () => {
  it("signs out when the refresh token itself is rejected", async () => {
    const storage = createMemoryStorage();
    await storage.setItem("pylo.auth_token", stale());
    await storage.setItem("pylo.refresh_token", "r1");
    const onSignOut = vi.fn();

    graphqlRequest.mockResolvedValue({
      errors: [{ message: "Invalid token", extensions: { code: "UNAUTHENTICATED" } }],
    });

    const store = createSessionStore({ ...options(), storage, onSignOut });
    await store.init();
    await store.getToken();

    expect(store.getState()).toEqual({ status: "signedOut", token: null });
    expect(await storage.getItem("pylo.refresh_token")).toBeNull();
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("keeps the session on a transient server error", async () => {
    const storage = createMemoryStorage();
    await storage.setItem("pylo.auth_token", stale());
    await storage.setItem("pylo.refresh_token", "r1");
    const onSignOut = vi.fn();

    graphqlRequest.mockResolvedValue({
      errors: [{ message: "boom", extensions: { code: "INTERNAL_SERVER_ERROR" } }],
    });

    const store = createSessionStore({ ...options(), storage, onSignOut });
    await store.init();
    await store.getToken();

    expect(store.getState().status).toBe("signedIn");
    expect(await storage.getItem("pylo.refresh_token")).toBe("r1");
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it("signs out when a stored session has no refresh token", async () => {
    const storage = createMemoryStorage();
    await storage.setItem("pylo.auth_token", stale());

    const store = createSessionStore({ ...options(), storage });
    await store.init();

    expect(await store.getToken()).toBeNull();
    expect(store.getState().status).toBe("signedOut");
    expect(graphqlRequest).not.toHaveBeenCalled();
  });
});

describe("refresh while signed out", () => {
  it("returns null without touching storage, state or the cache", async () => {
    const onSignOut = vi.fn();
    const store = createSessionStore({ ...options(), onSignOut });
    await store.init();
    const listener = vi.fn();
    store.subscribe(listener);

    expect(await store.refresh()).toBeNull();

    expect(graphqlRequest).not.toHaveBeenCalled();
    expect(onSignOut).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(store.getState().status).toBe("signedOut");
  });
});

describe("logout", () => {
  it("clears storage and state", async () => {
    const storage = createMemoryStorage();
    await storage.setItem("pylo.auth_token", fresh());
    await storage.setItem("pylo.refresh_token", "r1");
    const onSignOut = vi.fn();

    const store = createSessionStore({ ...options(), storage, onSignOut });
    await store.init();
    await store.logout();

    expect(store.getState()).toEqual({ status: "signedOut", token: null });
    expect(await storage.getItem("pylo.auth_token")).toBeNull();
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});

describe("subscribe", () => {
  it("notifies on every state change and stops after unsubscribe", async () => {
    const listener = vi.fn();
    const store = createSessionStore(options());
    const unsubscribe = store.subscribe(listener);

    await store.init();
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    const before = listener.mock.calls.length;
    await store.logout();
    expect(listener.mock.calls.length).toBe(before);
  });
});

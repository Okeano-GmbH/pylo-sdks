import { describe, it, expect, vi, beforeEach } from "vitest";

const getAuthToken = vi.fn<() => Promise<string | null>>();
vi.mock("@pylo/auth-nextjs/core", () => ({ getAuthToken }));

const { createPyloWsTokenRoute } = await import("../src/api.js");

beforeEach(() => getAuthToken.mockReset());

describe("createPyloWsTokenRoute", () => {
  it("returns the session's access token, uncached", async () => {
    getAuthToken.mockResolvedValue("jwt");
    const response = await createPyloWsTokenRoute().GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ token: "jwt" });
  });

  it("refuses without a session", async () => {
    getAuthToken.mockResolvedValue(null);
    const response = await createPyloWsTokenRoute().GET();

    expect(response.status).toBe(401);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const openAuthSessionAsync = vi.fn();
const digest = vi.fn();
const getRandomBytes = vi.fn();

vi.mock("expo-web-browser", () => ({
  openAuthSessionAsync,
  WebBrowserResultType: { CANCEL: "cancel", DISMISS: "dismiss", LOCKED: "locked" },
}));
vi.mock("expo-crypto", () => ({
  digest,
  getRandomBytes,
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
}));

const { openAuthSession, expoHandoffCrypto } = await import("../src/auth-session.js");

beforeEach(() => {
  openAuthSessionAsync.mockReset();
  digest.mockReset();
  getRandomBytes.mockReset();
});

describe("openAuthSession", () => {
  it("returns the final URL on success", async () => {
    openAuthSessionAsync.mockResolvedValue({ type: "success", url: "myapp://auth?code=c" });
    expect(await openAuthSession("https://idp/x", "myapp://auth")).toBe("myapp://auth?code=c");
    expect(openAuthSessionAsync).toHaveBeenCalledWith("https://idp/x", "myapp://auth");
  });

  it.each(["cancel", "dismiss"])("returns null on %s", async (type) => {
    openAuthSessionAsync.mockResolvedValue({ type });
    expect(await openAuthSession("https://idp/x", "myapp://auth")).toBeNull();
  });

  it("rejects when another auth session holds the browser", async () => {
    openAuthSessionAsync.mockResolvedValue({ type: "locked" });
    await expect(openAuthSession("https://idp/x", "myapp://auth")).rejects.toThrow(
      "Another login is already in progress",
    );
  });

  it("rejects when the browser rejects", async () => {
    openAuthSessionAsync.mockRejectedValue(new Error("boom"));
    await expect(openAuthSession("https://idp/x", "myapp://auth")).rejects.toThrow("boom");
  });
});

describe("expoHandoffCrypto", () => {
  it("hashes with SHA-256 via expo-crypto", async () => {
    const out = new ArrayBuffer(32);
    digest.mockResolvedValue(out);
    const data = new Uint8Array([1, 2]);
    expect(await expoHandoffCrypto.sha256(data)).toBe(out);
    expect(digest).toHaveBeenCalledWith("SHA-256", data);
  });

  it("gets random bytes from expo-crypto", async () => {
    const bytes = new Uint8Array(32);
    getRandomBytes.mockReturnValue(bytes);
    expect(await expoHandoffCrypto.randomBytes(32)).toBe(bytes);
    expect(getRandomBytes).toHaveBeenCalledWith(32);
  });
});

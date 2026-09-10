import { describe, it, expect, vi, beforeEach } from "vitest";

const getItemAsync = vi.fn();
const setItemAsync = vi.fn();
const deleteItemAsync = vi.fn();

vi.mock("expo-secure-store", () => ({ getItemAsync, setItemAsync, deleteItemAsync }));

const { createSecureStorage } = await import("../src/storage.js");

beforeEach(() => {
  getItemAsync.mockReset();
  setItemAsync.mockReset();
  deleteItemAsync.mockReset();
});

describe("createSecureStorage", () => {
  it("sanitizes keys SecureStore would reject", async () => {
    getItemAsync.mockResolvedValue("v");
    const storage = createSecureStorage();

    expect(await storage.getItem("pylo:auth token")).toBe("v");
    expect(getItemAsync).toHaveBeenCalledWith("pylo_auth_token");

    await storage.setItem("pylo:auth token", "v");
    expect(setItemAsync).toHaveBeenCalledWith("pylo_auth_token", "v");

    await storage.removeItem("pylo:auth token");
    expect(deleteItemAsync).toHaveBeenCalledWith("pylo_auth_token");
  });

  it("leaves an already-valid key alone", async () => {
    getItemAsync.mockResolvedValue(null);
    await createSecureStorage().getItem("pylo.auth_token");
    expect(getItemAsync).toHaveBeenCalledWith("pylo.auth_token");
  });
});

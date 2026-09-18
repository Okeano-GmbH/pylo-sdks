import { describe, it, expect, beforeEach } from "vitest";
import { createLocalStorageAdapter, createMemoryStorage } from "../src/session/storage.js";

describe("createMemoryStorage", () => {
  it("round-trips and removes values", async () => {
    const storage = createMemoryStorage();
    expect(await storage.getItem("a")).toBeNull();
    await storage.setItem("a", "1");
    expect(await storage.getItem("a")).toBe("1");
    await storage.removeItem("a");
    expect(await storage.getItem("a")).toBeNull();
  });
});

describe("createLocalStorageAdapter", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>)["localStorage"] = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });

  it("round-trips through localStorage", async () => {
    const storage = createLocalStorageAdapter();
    await storage.setItem("a", "1");
    expect(await storage.getItem("a")).toBe("1");
    await storage.removeItem("a");
    expect(await storage.getItem("a")).toBeNull();
  });

  it("degrades to memory when localStorage is unavailable", async () => {
    delete (globalThis as Record<string, unknown>)["localStorage"];
    const storage = createLocalStorageAdapter();
    await storage.setItem("a", "1");
    expect(await storage.getItem("a")).toBe("1");
  });

  it("degrades to memory when localStorage throws on write", async () => {
    (globalThis as Record<string, unknown>)["localStorage"] = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    const storage = createLocalStorageAdapter();
    await storage.setItem("a", "1");
    expect(await storage.getItem("a")).toBe("1");
  });
});

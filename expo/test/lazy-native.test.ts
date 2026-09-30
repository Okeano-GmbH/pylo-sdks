import { it, expect, vi } from "vitest";

const loaded: string[] = [];

vi.mock("expo-web-browser", () => {
  loaded.push("expo-web-browser");
  return {};
});
vi.mock("expo-crypto", () => {
  loaded.push("expo-crypto");
  return {};
});
vi.mock("expo-secure-store", () => ({}));
vi.mock("react-native", () => ({ AppState: {} }));

it("loads neither native module on import", async () => {
  await import("../src/provider.js");
  await import("../src/index.js");
  expect(loaded).toEqual([]);
});

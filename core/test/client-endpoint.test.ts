import { describe, it, expect, afterEach } from "vitest";
import { DEFAULT_GRAPHQL_ENDPOINT } from "@pylo/auth";

const { resolveEndpoint } = await import("../src/client.js");

const original = globalThis.process;

afterEach(() => {
  globalThis.process = original;
});

describe("resolveEndpoint", () => {
  it("returns the explicit endpoint when given one", () => {
    expect(resolveEndpoint("https://api.test/graphql")).toBe("https://api.test/graphql");
  });

  it("falls back to the default when process is undefined", () => {
    // A browser bundle has no `process`; reading it must not throw.
    // @ts-expect-error deleting a global for the duration of this test
    delete globalThis.process;
    expect(resolveEndpoint()).toBe(DEFAULT_GRAPHQL_ENDPOINT);
  });

  it("reads PYLO_GRAPHQL_ENDPOINT when process exists", () => {
    globalThis.process = {
      ...original,
      env: { ...original.env, PYLO_GRAPHQL_ENDPOINT: "https://env.test/graphql" },
    } as typeof original;
    expect(resolveEndpoint()).toBe("https://env.test/graphql");
  });
});

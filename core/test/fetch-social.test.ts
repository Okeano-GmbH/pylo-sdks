import { describe, it, expect } from "vitest";
import type { GraphQLResponse } from "@pylo/auth";
import {
  SOCIAL_BINDINGS_QUERY,
  fetchSocialBindingsWith,
} from "../src/codegen/fetch-social.js";

const binding = (provider: string, returnUrls: string[], isEnabled = true) => ({
  return_urls: JSON.stringify(returnUrls),
  is_enabled: isEnabled,
  pylo_auth_provider: { data: { provider } },
});

const page = (bindings: unknown[], hasMore = false) => ({
  data: {
    pyloAppAuthProviderList: {
      data: bindings,
      pagination: { total: bindings.length, has_more_pages: hasMore, current_page: 1 },
    },
  },
});

function recorder(respond: (page: number) => unknown) {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  return {
    calls,
    request: async <T,>(query: string, variables: Record<string, unknown>) => {
      calls.push({ query, variables });
      const pagination = variables["pagination"] as { page: number };
      return respond(pagination.page) as GraphQLResponse<T>;
    },
  };
}

describe("fetchSocialBindingsWith", () => {
  it("collects enabled providers and their deduped return URLs", async () => {
    const { request } = recorder(() =>
      page([
        binding("google", ["https://shop.example.com/cb", "myapp://auth"]),
        binding("microsoft", ["https://shop.example.com/cb", "https://admin.example.com/cb"]),
        binding("google", ["https://disabled.example.com/cb"], false),
      ]),
    );

    await expect(fetchSocialBindingsWith(request, "app-1")).resolves.toEqual({
      providers: ["google", "microsoft"],
      returnUrls: [
        "https://shop.example.com/cb",
        "myapp://auth",
        "https://admin.example.com/cb",
      ],
    });
  });

  // `pylo_app_id` is hidden on system entities, so the app is matched through the relation.
  it("filters by the app through the pylo_app relation", async () => {
    const { calls, request } = recorder(() => page([]));
    await fetchSocialBindingsWith(request, "app-1");

    expect(calls[0]!.query).toBe(SOCIAL_BINDINGS_QUERY);
    expect(calls[0]!.variables["filter"]).toEqual({
      query: [{ condition: { field: "pylo_app.id", operator: "equal", value: "app-1" } }],
    });
  });

  it("pages until has_more_pages is false", async () => {
    const { calls, request } = recorder((n) =>
      n === 1
        ? page([binding("google", ["https://a.example.com/cb"])], true)
        : page([binding("microsoft", ["https://b.example.com/cb"])]),
    );

    const result = await fetchSocialBindingsWith(request, "app-1");
    expect(calls).toHaveLength(2);
    expect(result.providers).toEqual(["google", "microsoft"]);
  });

  it("dedupes a provider bound more than once", async () => {
    const { request } = recorder(() =>
      page([
        binding("google", ["https://a.example.com/cb"]),
        binding("google", ["https://b.example.com/cb"]),
      ]),
    );

    const result = await fetchSocialBindingsWith(request, "app-1");
    expect(result.providers).toEqual(["google"]);
  });

  it("skips a binding whose provider is not readable", async () => {
    const { request } = recorder(() =>
      page([
        { return_urls: '["https://hidden.example.com/cb"]', is_enabled: true, pylo_auth_provider: null },
        binding("google", ["https://a.example.com/cb"]),
      ]),
    );

    await expect(fetchSocialBindingsWith(request, "app-1")).resolves.toEqual({
      providers: ["google"],
      returnUrls: ["https://a.example.com/cb"],
    });
  });

  it("ignores return URLs that are not a JSON list", async () => {
    const { request } = recorder(() =>
      page([
        { ...binding("google", []), return_urls: "not json" },
        { ...binding("microsoft", []), return_urls: '{"url":"https://x.example.com"}' },
      ]),
    );

    await expect(fetchSocialBindingsWith(request, "app-1")).resolves.toEqual({
      providers: ["google", "microsoft"],
      returnUrls: [],
    });
  });

  it("throws with the app id when the request fails", async () => {
    const request = async () => {
      throw new Error("ECONNREFUSED");
    };
    await expect(fetchSocialBindingsWith(request, "app-1")).rejects.toThrow(
      "Failed to fetch login providers for app app-1: ECONNREFUSED",
    );
  });

  it("throws with the GraphQL errors", async () => {
    const { request } = recorder(() => ({ errors: [{ message: "No permission" }] }));
    await expect(fetchSocialBindingsWith(request, "app-1")).rejects.toThrow(
      "Failed to fetch login providers for app app-1: No permission",
    );
  });

  it("throws with a general error", async () => {
    const { request } = recorder(() => ({ errors: { generalError: { message: "Unauthorized" } } }));
    await expect(fetchSocialBindingsWith(request, "app-1")).rejects.toThrow(
      "Failed to fetch login providers for app app-1: Unauthorized",
    );
  });
});

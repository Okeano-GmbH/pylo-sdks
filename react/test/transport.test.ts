import { describe, it, expect, vi, beforeEach } from "vitest";

const graphqlRequest = vi.fn();

vi.mock("@pylo/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pylo/auth")>();
  return { ...actual, graphqlRequest };
});

const { createDirectTransport } = await import("../src/transport.js");
const { PyloError } = await import("@pylo/core");

beforeEach(() => {
  graphqlRequest.mockReset();
});

describe("createDirectTransport", () => {
  it("sends the token and returns the data envelope's contents", async () => {
    graphqlRequest.mockResolvedValue({ data: { contactList: { data: [] } } });

    const transport = createDirectTransport({
      endpoint: "https://api.test/graphql",
      getToken: async () => "t1",
    });

    const result = await transport("query {}", { a: 1 }, { "x-tenant": "acme" });

    expect(result).toEqual({ contactList: { data: [] } });
    expect(graphqlRequest).toHaveBeenCalledWith(
      "https://api.test/graphql",
      "query {}",
      { a: 1 },
      { token: "t1", headers: { "x-tenant": "acme" } },
    );
  });

  it("omits the token when there is no session", async () => {
    graphqlRequest.mockResolvedValue({ data: { ok: true } });

    const transport = createDirectTransport({
      endpoint: "https://api.test/graphql",
      getToken: async () => null,
    });

    await transport("query {}", {});
    expect(graphqlRequest.mock.calls[0]?.[3]).toEqual({});
  });

  it("throws a PyloError carrying the API's error code", async () => {
    graphqlRequest.mockResolvedValue({
      errors: [{ message: "No read permission", extensions: { code: "FORBIDDEN" } }],
    });

    const transport = createDirectTransport({
      endpoint: "https://api.test/graphql",
      getToken: async () => "t1",
    });

    await expect(transport("query {}", {})).rejects.toMatchObject({
      name: "PyloError",
      message: "No read permission",
      code: "FORBIDDEN",
    });
  });

  it("refreshes once and retries when the request is unauthorized", async () => {
    graphqlRequest
      .mockResolvedValueOnce({
        errors: [{ message: "expired token", extensions: { code: "UNAUTHENTICATED" } }],
      })
      .mockResolvedValueOnce({ data: { ok: true } });

    const onUnauthorized = vi.fn(async () => "t2");
    const transport = createDirectTransport({
      endpoint: "https://api.test/graphql",
      getToken: async () => "t1",
      onUnauthorized,
    });

    expect(await transport("query {}", {})).toEqual({ ok: true });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(graphqlRequest.mock.calls[1]?.[3]).toMatchObject({ token: "t2" });
  });

  it("does not retry more than once", async () => {
    graphqlRequest.mockResolvedValue({
      errors: [{ message: "expired token", extensions: { code: "UNAUTHENTICATED" } }],
    });

    const transport = createDirectTransport({
      endpoint: "https://api.test/graphql",
      getToken: async () => "t1",
      onUnauthorized: async () => "t2",
    });

    await expect(transport("query {}", {})).rejects.toBeInstanceOf(PyloError);
    expect(graphqlRequest).toHaveBeenCalledTimes(2);
  });

  it("gives up without retrying when the refresh yields no token", async () => {
    graphqlRequest.mockResolvedValue({
      errors: [{ message: "expired token", extensions: { code: "UNAUTHENTICATED" } }],
    });

    const transport = createDirectTransport({
      endpoint: "https://api.test/graphql",
      getToken: async () => "t1",
      onUnauthorized: async () => null,
    });

    await expect(transport("query {}", {})).rejects.toBeInstanceOf(PyloError);
    expect(graphqlRequest).toHaveBeenCalledTimes(1);
  });

  it("throws when the response carries neither data nor errors", async () => {
    graphqlRequest.mockResolvedValue({});

    const transport = createDirectTransport({
      endpoint: "https://api.test/graphql",
      getToken: async () => "t1",
    });

    await expect(transport("query {}", {})).rejects.toThrow(/No data returned/);
  });
});

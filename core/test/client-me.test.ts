import { describe, it, expect, vi, beforeEach } from "vitest";

// Intercept the transport so the `me` endpoint's runtime path — query built,
// request issued, response unwrapped — is exercised without a live API.
const graphqlRequest = vi.fn();

vi.mock("@pylo/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pylo/auth")>();
  return { ...actual, graphqlRequest };
});

const { createPyloClient } = await import("../src/client.js");

interface TestSchema {
  contact: {
    fields: { id: string; name: string };
    relations: Record<never, never>;
    updateInput: Record<string, never>;
  };
  me: {
    fields: { authenticaton_method: string };
    relations: { current_user: { type: "hasOne"; entity: "contact" } };
    virtual: true;
  };
}

const client = createPyloClient<TestSchema>({
  endpoint: "https://example.test/graphql",
  auth: async () => ({ token: "t" }),
});

beforeEach(() => {
  graphqlRequest.mockReset();
});

describe("client.me — runtime", () => {
  it("sends the selection and returns the unwrapped payload", async () => {
    graphqlRequest.mockResolvedValue({
      data: {
        me: {
          authenticaton_method: "password",
          current_user: { data: { id: "u1", name: "Ada" } },
        },
      },
    });

    const me = await client.me({
      select: {
        authenticaton_method: true,
        current_user: { select: { id: true, name: true } },
      },
    });

    // `me` is returned directly — no `data` envelope at the top level.
    expect(me).toEqual({
      authenticaton_method: "password",
      current_user: { data: { id: "u1", name: "Ada" } },
    });

    const [, query, variables] = graphqlRequest.mock.calls[0]!;
    expect(query.replace(/\s+/g, " ")).toContain(
      "me { authenticaton_method current_user { data { id name } } }",
    );
    expect(variables).toEqual({});
  });

  it("does not send an id argument", async () => {
    graphqlRequest.mockResolvedValue({ data: { me: {} } });
    await client.me({ select: { authenticaton_method: true } });

    const [, query] = graphqlRequest.mock.calls[0]!;
    expect(query).not.toContain("$id");
  });

  it("passes per-request headers through", async () => {
    graphqlRequest.mockResolvedValue({ data: { me: {} } });
    await client.me({
      select: { authenticaton_method: true },
      headers: { "x-trace": "abc" },
    });

    const [, , , options] = graphqlRequest.mock.calls[0]!;
    expect(options.headers).toMatchObject({ "x-trace": "abc" });
  });

  it("throws a PyloError when the payload has no `me`", async () => {
    graphqlRequest.mockResolvedValue({ data: {} });
    await expect(
      client.me({ select: { authenticaton_method: true } }),
    ).rejects.toThrow(/missing me/);
  });

  it("surfaces GraphQL errors", async () => {
    graphqlRequest.mockResolvedValue({
      errors: [{ message: "Unauthenticated." }],
    });
    await expect(
      client.me({ select: { authenticaton_method: true } }),
    ).rejects.toThrow(/Unauthenticated/);
  });

  it("still requires an explicit select at runtime", async () => {
    await expect(
      // @ts-expect-error — exercising the runtime guard, not the type
      client.me({}),
    ).rejects.toThrow(/requires an explicit 'select'/);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getAuthToken = vi.fn<() => Promise<string | null>>();
vi.mock("@pylo/auth-nextjs/core", () => ({ getAuthToken }));

const { createPyloApiRoute } = await import("../src/api.js");

const fetchMock = vi.fn<typeof fetch>();

function pyloAnswers(status: number, body: unknown) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function post() {
  return createPyloApiRoute({ endpoint: "https://pylo.test/graphql" }).POST(
    new Request("http://app.test/api/graphql", {
      method: "POST",
      body: JSON.stringify({ query: "{ __typename }" }),
    }),
  );
}

beforeEach(() => {
  getAuthToken.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("createPyloApiRoute", () => {
  it("refuses without a session", async () => {
    getAuthToken.mockResolvedValue(null);
    const response = await post();

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes on a 401 when Pylo rejects the token", async () => {
    getAuthToken.mockResolvedValue("jwt");
    pyloAnswers(401, {
      data: null,
      errors: [{ message: "Wrong number of segments", extensions: { code: "UNAUTHENTICATED" } }],
    });
    const response = await post();

    expect(response.status).toBe(401);
    expect((await response.json()).errors[0].extensions.code).toBe("UNAUTHENTICATED");
  });

  it("keeps ordinary GraphQL errors at 200", async () => {
    getAuthToken.mockResolvedValue("jwt");
    pyloAnswers(200, {
      data: null,
      errors: [
        {
          message: 'Cannot query field "me" on type "Query".',
          extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
        },
      ],
    });
    const response = await post();

    expect(response.status).toBe(200);
  });
});

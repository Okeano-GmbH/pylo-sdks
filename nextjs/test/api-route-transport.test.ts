import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApiRouteTransport, fetchWsToken } from "../src/hooks.js";
import { isPyloUnauthorized, PyloError } from "../src/index.js";

const fetchMock = vi.fn<typeof fetch>();

function routeAnswers(status: number, body: unknown, statusText = "") {
  fetchMock.mockResolvedValue(
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      statusText,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

const run = () => createApiRouteTransport()("{ __typename }", {}, { "x-tenant": "t1" });

const rejection = async () => {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("transport resolved");
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("createApiRouteTransport", () => {
  it("posts to /api/graphql and returns the data", async () => {
    routeAnswers(200, { data: { __typename: "Query" } });

    expect(await run()).toEqual({ __typename: "Query" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/graphql");
    expect(JSON.parse(init!.body as string)).toEqual({
      query: "{ __typename }",
      variables: {},
      headers: { "x-tenant": "t1" },
    });
  });

  it("throws a PyloError with status and code when the route answers 401", async () => {
    routeAnswers(
      401,
      { data: null, errors: [{ message: "Wrong number of segments", extensions: { code: "UNAUTHENTICATED" } }] },
      "Unauthorized",
    );

    const error = await rejection();

    expect(error).toBeInstanceOf(PyloError);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      message: "GraphQL request failed: 401 Unauthorized",
      httpStatus: 401,
      code: "UNAUTHENTICATED",
    });
    expect(isPyloUnauthorized(error)).toBe(true);
  });

  it("keeps the status when the body is not JSON", async () => {
    routeAnswers(401, "<html>nope</html>", "Unauthorized");

    const error = await rejection();

    expect(error).toMatchObject({ httpStatus: 401, code: null });
    expect(isPyloUnauthorized(error)).toBe(true);
  });

  it("does not report a 500 as unauthorized", async () => {
    routeAnswers(500, { errors: [{ message: "Internal server error" }] }, "Internal Server Error");

    const error = await rejection();

    expect(error).toMatchObject({
      message: "GraphQL request failed: 500 Internal Server Error",
      httpStatus: 500,
    });
    expect(isPyloUnauthorized(error)).toBe(false);
  });

  it("throws GraphQL errors on a 200 with their code and joined messages", async () => {
    routeAnswers(200, {
      data: null,
      errors: [
        { message: "No read permission", extensions: { code: "FORBIDDEN" } },
        { message: "second" },
      ],
    });

    const error = await rejection();

    expect(error).toBeInstanceOf(PyloError);
    expect(error).toMatchObject({
      message: "No read permission, second",
      code: "FORBIDDEN",
      httpStatus: null,
    });
    expect(isPyloUnauthorized(error)).toBe(false);
  });
});

describe("fetchWsToken", () => {
  it("returns the token from the default route", async () => {
    routeAnswers(200, { token: "jwt" });

    expect(await fetchWsToken()).toEqual({ token: "jwt" });
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/pylo/ws-token");
  });

  it("returns no token without a session", async () => {
    routeAnswers(401, { error: "Unauthorized" });

    expect(await fetchWsToken("/custom")).toEqual({});
  });
});

describe("isPyloUnauthorized", () => {
  it("ignores plain errors and non-errors", () => {
    expect(isPyloUnauthorized(new Error("GraphQL request failed: 401 Unauthorized"))).toBe(false);
    expect(isPyloUnauthorized(null)).toBe(false);
    expect(isPyloUnauthorized("401")).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  graphqlRequest,
  hasErrors,
  isUnauthorizedError,
  extractErrorCode,
  extractHttpStatus,
} from "../src/index.js";

const fetchMock = vi.fn();

const respond = (status: number, body: string) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const request = () => graphqlRequest("https://api.test/graphql", "query { me }");

describe("graphqlRequest", () => {
  it("returns a successful envelope unchanged", async () => {
    fetchMock.mockResolvedValue(respond(200, JSON.stringify({ data: { me: 1 } })));

    expect(await request()).toEqual({ data: { me: 1 } });
  });

  // The API answers auth failures with a 401 *and* its own errors envelope; that
  // classification is better than anything we could synthesize.
  it("preserves the API's own envelope on a non-2xx", async () => {
    const envelope = {
      data: null,
      errors: [
        {
          message: "OAuth grant was revoked",
          extensions: { code: "UNAUTHENTICATED", referenceId: "abc" },
        },
      ],
    };
    fetchMock.mockResolvedValue(respond(401, JSON.stringify(envelope)));

    const response = await request();

    expect(response).toEqual(envelope);
    expect(extractHttpStatus(response.errors)).toBeNull();
  });

  // A proxy's HTML error page used to escape as `SyntaxError: Unexpected token '<'`.
  it("reports an unparseable body as an error instead of throwing", async () => {
    fetchMock.mockResolvedValue(respond(502, "<html>Bad Gateway</html>"));

    const response = await request();

    expect(hasErrors(response)).toBe(true);
    expect(extractErrorCode(response.errors)).toBe("NETWORK_ERROR");
    expect(extractHttpStatus(response.errors)).toBe(502);
    expect(response.data).toBeUndefined();
  });

  it("reports a non-2xx JSON body that carries no errors of its own", async () => {
    fetchMock.mockResolvedValue(respond(401, JSON.stringify({ error: "JWTException" })));

    const response = await request();

    expect(extractErrorCode(response.errors)).toBe("UNAUTHENTICATED");
    expect(isUnauthorizedError(response)).toBe(true);
  });

  it("does not treat a proxy 403 as an auth failure", async () => {
    fetchMock.mockResolvedValue(respond(403, "<html>Blocked</html>"));

    const response = await request();

    expect(extractErrorCode(response.errors)).toBe("FORBIDDEN");
    expect(isUnauthorizedError(response)).toBe(false);
  });

  it("leaves a network rejection to the caller", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(request()).rejects.toThrow("ECONNREFUSED");
  });
});

describe("extractErrorCode", () => {
  it("reads the code off the custom error shape", () => {
    expect(
      extractErrorCode({ generalError: { errorCode: "FORBIDDEN", message: "nope" } }),
    ).toBe("FORBIDDEN");
  });

  it("returns null when there are no errors", () => {
    expect(extractErrorCode(undefined)).toBeNull();
  });
});

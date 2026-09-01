import { describe, it, expect, vi, beforeEach } from "vitest";

const graphqlRequest = vi.fn();

vi.mock("@pylo/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pylo/auth")>();
  return { ...actual, graphqlRequest };
});

const { createPyloClient, PyloError } = await import("../src/client.js");

const client = createPyloClient<{
  contact: {
    fields: { id: string };
    relations: Record<never, never>;
    updateInput: Record<string, never>;
  };
}>({
  endpoint: "https://api.test/graphql",
  auth: async () => ({ token: "t" }),
});

const list = () => client.contact.list({ select: { id: true } });

beforeEach(() => {
  graphqlRequest.mockReset();
});

describe("PyloError", () => {
  // The message is human-facing and changes; `extensions.code` is the API's own
  // classification, so callers should be able to branch on it.
  it("carries the API's error code and keeps the message as thrown", async () => {
    graphqlRequest.mockResolvedValue({
      data: null,
      errors: [
        {
          message: "No read permission on entity Contact!",
          extensions: { code: "FORBIDDEN", referenceId: "abc" },
        },
      ],
    });

    await expect(list()).rejects.toMatchObject({
      message: "No read permission on entity Contact!",
      code: "FORBIDDEN",
      httpStatus: null,
    });
  });

  it("carries the http status of an error the transport synthesized", async () => {
    graphqlRequest.mockResolvedValue({
      errors: [
        {
          message: "Pylo returned a non-JSON response (HTTP 502)",
          extensions: { code: "NETWORK_ERROR", httpStatus: 502 },
        },
      ],
    });

    await expect(list()).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      httpStatus: 502,
    });
  });

  it("leaves code null for an error raised by the client itself", () => {
    const error = new PyloError("Unexpected response shape");

    expect(error.code).toBeNull();
    expect(error.httpStatus).toBeNull();
  });
});

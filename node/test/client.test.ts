import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Intercept the transport at the boundary @pylo/core actually calls, so these
// tests exercise the real createPyloNode → createPyloClient wiring.
const graphqlRequest = vi.fn();

vi.mock("@pylo/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pylo/auth")>();
  return { ...actual, graphqlRequest };
});

const { DEFAULT_GRAPHQL_ENDPOINT } = await import("@pylo/auth");
const { createPyloNode, pylo } = await import("../src/index.js");

interface TestSchema {
  contact: {
    fields: { id: string; name: string };
    relations: Record<never, never>;
    updateInput: Record<string, never>;
  };
  me: {
    fields: { authenticaton_method: string };
    relations: Record<never, never>;
    virtual: true;
  };
}

const FLOW_CLIENT_KEY = "__PYLO_FLOW_CLIENT__";
const globals = globalThis as Record<string, unknown>;

// `getEndpoint` consults this before falling back to the default, so a stray
// value in the ambient environment would make the default-endpoint test lie.
const savedEnvEndpoint = process.env["PYLO_GRAPHQL_ENDPOINT"];

beforeEach(() => {
  graphqlRequest.mockReset();
  graphqlRequest.mockResolvedValue({
    data: { contactList: { data: [], pagination: {} } },
  });
  delete process.env["PYLO_GRAPHQL_ENDPOINT"];
  delete globals[FLOW_CLIENT_KEY];
});

afterEach(() => {
  if (savedEnvEndpoint !== undefined) {
    process.env["PYLO_GRAPHQL_ENDPOINT"] = savedEnvEndpoint;
  }
  delete globals[FLOW_CLIENT_KEY];
});

const call = () => graphqlRequest.mock.calls[0]!;

describe("createPyloNode — auth", () => {
  it("authenticates with the api key, not a bearer token", async () => {
    const client = createPyloNode<TestSchema>({ apiKey: "secret-key" });
    await client.contact.list({ select: { id: true } });

    const [, , , options] = call();
    expect(options).toMatchObject({ apiKey: "secret-key" });
    expect(options.token).toBeUndefined();
  });

  it("resolves the api key per request rather than capturing it once", async () => {
    const client = createPyloNode<TestSchema>({ apiKey: "k1" });
    await client.contact.list({ select: { id: true } });
    await client.contact.list({ select: { id: true } });

    expect(graphqlRequest).toHaveBeenCalledTimes(2);
    for (const [, , , options] of graphqlRequest.mock.calls) {
      expect(options.apiKey).toBe("k1");
    }
  });
});

describe("createPyloNode — endpoint", () => {
  it("uses a custom endpoint when given", async () => {
    const client = createPyloNode<TestSchema>({
      apiKey: "k",
      endpoint: "https://custom.test/graphql",
    });
    await client.contact.list({ select: { id: true } });

    expect(call()[0]).toBe("https://custom.test/graphql");
  });

  // Note: this does not guard the conditional spread in createPyloNode. Core's
  // `getEndpoint` treats an explicit `undefined` exactly like an omitted value,
  // so dropping the spread is invisible at runtime (verified by mutation) — it
  // is `exactOptionalPropertyTypes` that requires it, and tsc that enforces it.
  it("falls back to the default endpoint when omitted", async () => {
    const client = createPyloNode<TestSchema>({ apiKey: "k" });
    await client.contact.list({ select: { id: true } });

    expect(call()[0]).toBe(DEFAULT_GRAPHQL_ENDPOINT);
  });

  it("prefers PYLO_GRAPHQL_ENDPOINT over the default", async () => {
    process.env["PYLO_GRAPHQL_ENDPOINT"] = "https://from-env.test/graphql";
    const client = createPyloNode<TestSchema>({ apiKey: "k" });
    await client.contact.list({ select: { id: true } });

    expect(call()[0]).toBe("https://from-env.test/graphql");
  });

  it("lets an explicit endpoint win over the environment", async () => {
    process.env["PYLO_GRAPHQL_ENDPOINT"] = "https://from-env.test/graphql";
    const client = createPyloNode<TestSchema>({
      apiKey: "k",
      endpoint: "https://explicit.test/graphql",
    });
    await client.contact.list({ select: { id: true } });

    expect(call()[0]).toBe("https://explicit.test/graphql");
  });
});

describe("createPyloNode — headers", () => {
  it("sends client-level headers", async () => {
    const client = createPyloNode<TestSchema>({
      apiKey: "k",
      headers: { "x-tenant": "acme" },
    });
    await client.contact.list({ select: { id: true } });

    expect(call()[3].headers).toMatchObject({ "x-tenant": "acme" });
  });

  it("merges per-request headers with client-level ones", async () => {
    const client = createPyloNode<TestSchema>({
      apiKey: "k",
      headers: { "x-tenant": "acme" },
    });
    await client.contact.list({
      select: { id: true },
      headers: { "x-trace": "abc" },
    });

    expect(call()[3].headers).toMatchObject({
      "x-tenant": "acme",
      "x-trace": "abc",
    });
  });

  it("omits headers entirely when none are configured", async () => {
    const client = createPyloNode<TestSchema>({ apiKey: "k" });
    await client.contact.list({ select: { id: true } });

    expect(call()[3].headers).toBeUndefined();
  });
});

describe("createPyloNode — me", () => {
  it("reaches the me endpoint through the node client", async () => {
    graphqlRequest.mockResolvedValue({
      data: { me: { authenticaton_method: "api_key" } },
    });

    const client = createPyloNode<TestSchema>({ apiKey: "k" });
    const me = await client.me({ select: { authenticaton_method: true } });

    expect(me).toEqual({ authenticaton_method: "api_key" });
    expect(call()[1].replace(/\s+/g, " ")).toContain(
      "me { authenticaton_method }",
    );
  });
});

describe("pylo — injected flow client", () => {
  it("throws a directed error when the flow client is absent", () => {
    expect(() => pylo.contact).toThrow(/only usable inside a Pylo flow action/);
  });

  // The proxy must read globalThis on every access: the flow runtime injects the
  // client after this module is imported, so an import-time capture would always
  // see `undefined`.
  it("resolves against a client injected after import", async () => {
    globals[FLOW_CLIENT_KEY] = createPyloNode<TestSchema>({
      apiKey: "flow-key",
    });

    graphqlRequest.mockResolvedValue({
      data: { me: { authenticaton_method: "flow" } },
    });

    const me = await (pylo as ReturnType<typeof createPyloNode<TestSchema>>).me(
      {
        select: { authenticaton_method: true },
      },
    );

    expect(me).toEqual({ authenticaton_method: "flow" });
    expect(call()[3].apiKey).toBe("flow-key");
  });

  it("picks up a replacement client on the next access", () => {
    globals[FLOW_CLIENT_KEY] = { marker: "first" };
    expect((pylo as unknown as { marker: string }).marker).toBe("first");

    globals[FLOW_CLIENT_KEY] = { marker: "second" };
    expect((pylo as unknown as { marker: string }).marker).toBe("second");
  });

  it("throws again once the flow client is removed", () => {
    globals[FLOW_CLIENT_KEY] = { marker: "present" };
    expect((pylo as unknown as { marker: string }).marker).toBe("present");

    delete globals[FLOW_CLIENT_KEY];
    expect(() => pylo.contact).toThrow(
      /globalThis.__PYLO_FLOW_CLIENT__ is unset/,
    );
  });
});

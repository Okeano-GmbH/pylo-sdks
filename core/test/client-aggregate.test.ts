import { describe, it, expect, vi, beforeEach } from "vitest";

// Intercept the transport so the aggregate runtime path — query built, request
// issued, envelope unwrapped, metric values coerced — runs without a live API.
const graphqlRequest = vi.fn();

vi.mock("@pylo/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pylo/auth")>();
  return { ...actual, graphqlRequest };
});

const { createPyloClient } = await import("../src/client.js");

interface TestSchema {
  creditNoteItem: {
    fields: {
      id: string;
      integer_id: number;
      amount: number | null;
      status: "open" | "paid";
      created_at: string;
    };
    relations: Record<never, never>;
    updateInput: Record<string, never>;
  };
  // A system entity: no list/byId/upsert endpoints, but aggregatable.
  pyloUser: {
    fields: { id: string; integer_id: number; email: string };
    relations: Record<never, never>;
    virtual: true;
  };
}

const client = createPyloClient<TestSchema>({
  endpoint: "https://example.test/graphql",
  auth: async () => ({ token: "t" }),
});

const entityPayload = (rows: unknown, total: unknown) => ({
  data: { entityInstanceAggregate: { rows, total } },
});

const eventPayload = (data: unknown, aggregations: unknown) => ({
  data: { pyloEventList: { data, aggregations } },
});

beforeEach(() => {
  graphqlRequest.mockReset();
});

describe("<entity>.aggregate — runtime", () => {
  it("returns the total and no rows when there is no breakdown", async () => {
    graphqlRequest.mockResolvedValue(entityPayload([], { n: 1334 }));

    const result = await client.creditNoteItem.aggregate({ metrics: { n: "count" } });

    expect(result).toEqual({ rows: [], total: { n: 1334 } });
  });

  it("coerces numeric-string metric values to numbers", async () => {
    // The exact shape the live API returns: `count` as a JSON number, but
    // sum/avg/min as strings, because Postgres renders `numeric` as a string.
    graphqlRequest.mockResolvedValue(
      entityPayload([], { s: "1990", a: "10.815217391304348", mn: "10", n: 184 }),
    );

    const result = await client.creditNoteItem.aggregate({
      metrics: {
        s: { sum: "amount" },
        a: { avg: "amount" },
        mn: { min: "amount" },
        n: "count",
      },
    });

    expect(result.total).toEqual({ s: 1990, a: 10.815217391304348, mn: 10, n: 184 });
    for (const value of Object.values(result.total)) {
      expect(typeof value).toBe("number");
    }
  });

  it("keeps a null metric as null rather than coercing it to 0", async () => {
    graphqlRequest.mockResolvedValue(entityPayload([], { s: null }));

    const result = await client.creditNoteItem.aggregate({
      metrics: { s: { sum: "amount" } },
    });

    expect(result.total.s).toBeNull();
  });

  it("coerces metrics inside breakdown rows but leaves dimension values alone", async () => {
    // `status` groups by the enum value's UUID — a numeric-looking group key
    // must survive untouched, which is why only metric aliases are coerced.
    graphqlRequest.mockResolvedValue(
      entityPayload(
        [
          { status: "1df2a7aa-5001-4af9-8d06-02d7ed96470d", revenue: "481.5" },
          { status: "12345", revenue: "155" },
        ],
        { revenue: "636.5" },
      ),
    );

    const result = await client.creditNoteItem.aggregate({
      metrics: { revenue: { sum: "amount" } },
      groupBy: ["status"],
    });

    expect(result.rows).toEqual([
      { status: "1df2a7aa-5001-4af9-8d06-02d7ed96470d", revenue: 481.5 },
      { status: "12345", revenue: 155 },
    ]);
    expect(result.total).toEqual({ revenue: 636.5 });
  });

  it("sends the PascalCase entity name the resolver expects", async () => {
    graphqlRequest.mockResolvedValue(entityPayload([], { n: 0 }));
    await client.creditNoteItem.aggregate({ metrics: { n: "count" } });

    const [, , variables] = graphqlRequest.mock.calls[0]!;
    expect(variables.entityName).toBe("CreditNoteItem");
  });

  it("works on a system entity, which has no other endpoints", async () => {
    graphqlRequest.mockResolvedValue(entityPayload([], { n: 44 }));

    const result = await client.pyloUser.aggregate({ metrics: { n: "count" } });

    expect(result.total.n).toBe(44);
    const [, , variables] = graphqlRequest.mock.calls[0]!;
    expect(variables.entityName).toBe("PyloUser");
  });

  it("passes per-request headers through", async () => {
    graphqlRequest.mockResolvedValue(entityPayload([], { n: 0 }));
    await client.creditNoteItem.aggregate({
      metrics: { n: "count" },
      headers: { "x-trace": "abc" },
    });

    const [, , , options] = graphqlRequest.mock.calls[0]!;
    expect(options.headers).toMatchObject({ "x-trace": "abc" });
  });

  it("throws a PyloError when the payload has no aggregate key", async () => {
    graphqlRequest.mockResolvedValue({ data: {} });

    await expect(
      client.creditNoteItem.aggregate({ metrics: { n: "count" } }),
    ).rejects.toThrow(/missing entityInstanceAggregate/);
  });

  it("surfaces the resolver's validation errors", async () => {
    graphqlRequest.mockResolvedValue({
      errors: [
        {
          message:
            "Cannot apply `sum` to non-numeric field `comment` on CreditNoteItem (type: text).",
        },
      ],
    });

    await expect(
      client.creditNoteItem.aggregate({ metrics: { n: "count" } }),
    ).rejects.toThrow(/non-numeric field/);
  });
});

describe("<entity>.count — runtime", () => {
  it("returns the bare number", async () => {
    graphqlRequest.mockResolvedValue(entityPayload([], { count: 1334 }));

    expect(await client.creditNoteItem.count()).toBe(1334);
  });

  it("applies a query filter", async () => {
    graphqlRequest.mockResolvedValue(entityPayload([], { count: 12 }));

    const query = [
      { condition: { field: "status", operator: "equal" as const, value: "paid" } },
    ];
    await client.creditNoteItem.count({ query });

    const [, , variables] = graphqlRequest.mock.calls[0]!;
    expect(variables.filter.query).toEqual(query);
  });
});

describe("events.aggregate — runtime", () => {
  it("renames the data/aggregations envelope to rows/total", async () => {
    graphqlRequest.mockResolvedValue(
      eventPayload(
        [
          { bucket: "2026-05-01T00:00:00+00:00", hits: 212781 },
          { bucket: "2026-05-02T00:00:00+00:00", hits: 961128 },
        ],
        { hits: 69129080 },
      ),
    );

    const result = await client.events.aggregate({
      metrics: { hits: "count" },
      groupBy: [{ interval: "1 day" }],
    });

    expect(result).toEqual({
      rows: [
        { bucket: "2026-05-01T00:00:00+00:00", hits: 212781 },
        { bucket: "2026-05-02T00:00:00+00:00", hits: 961128 },
      ],
      total: { hits: 69129080 },
    });
  });

  it("treats a null `aggregations` as an empty total", async () => {
    graphqlRequest.mockResolvedValue(eventPayload([], null));

    const result = await client.events.aggregate({ metrics: { hits: "count" } });

    expect(result.total).toEqual({ hits: null });
  });

  it("throws a PyloError when the payload has no pyloEventList", async () => {
    graphqlRequest.mockResolvedValue({ data: {} });

    await expect(
      client.events.aggregate({ metrics: { hits: "count" } }),
    ).rejects.toThrow(/missing pyloEventList/);
  });
});

describe("events.count — runtime", () => {
  it("returns the bare number", async () => {
    graphqlRequest.mockResolvedValue(eventPayload([{ ts: "…" }], { count: 69129080 }));

    expect(await client.events.count()).toBe(69129080);
  });

  it("passes startTime through", async () => {
    graphqlRequest.mockResolvedValue(eventPayload([], { count: 5 }));
    await client.events.count({ startTime: "2026-07-01T00:00:00Z" });

    const [, , variables] = graphqlRequest.mock.calls[0]!;
    expect(variables.startTime).toBe("2026-07-01T00:00:00Z");
  });
});

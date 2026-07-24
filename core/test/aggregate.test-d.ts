import { describe, it, expectTypeOf } from "vitest";
import type { NumericFieldName } from "../src/types.js";
import type { AggregateResult } from "../src/shared-types.js";
import type { PyloClient } from "../src/client.js";

// A schema in the shape codegen emits, with the field types that matter here:
// a real numeric field, the synthetic `integer_id`, an enum, and a datetime.
interface MockSchema {
  creditNoteItem: {
    fields: {
      id: string;
      integer_id: number;
      amount: number | null;
      comment: string | null;
      status: "open" | "paid";
      created_at: string;
    };
    relations: { credit_note: { type: "hasOne"; entity: "creditNote" } };
    updateInput: Record<string, never>;
  };
  creditNote: {
    fields: { id: string; reference: string };
    relations: Record<never, never>;
    updateInput: Record<string, never>;
  };
  // A system entity: aggregatable, but with no other endpoints.
  pyloUser: {
    fields: { id: string; integer_id: number; email: string };
    relations: Record<never, never>;
    virtual: true;
  };
}

// Everything is exercised through the client, because that is where the `const`
// generics infer the metric keys and the groupBy tuple — the same inference a
// caller gets.
const client = {} as PyloClient<MockSchema>;

describe("aggregate metrics", () => {
  it("accepts the `count` shorthand and per-function objects", async () => {
    const result = await client.creditNoteItem.aggregate({
      metrics: {
        orders: "count",
        revenue: { sum: "amount" },
        biggest: { max: "amount" },
        distinctStatuses: { count: "status" },
      },
    });

    expectTypeOf(result.total.orders).toEqualTypeOf<number | null>();
    expectTypeOf(result.total.distinctStatuses).toEqualTypeOf<number | null>();
  });

  it("rejects sum over a non-numeric field", async () => {
    await client.creditNoteItem.aggregate({
      // @ts-expect-error — `comment` is text; the resolver rejects this at runtime
      metrics: { bad: { sum: "comment" } },
    });
  });

  it("rejects an unknown field", async () => {
    await client.creditNoteItem.aggregate({
      // @ts-expect-error — `nope` is not a field on creditNoteItem
      metrics: { bad: { sum: "nope" } },
    });
  });

  // Note: two functions in one metric ({ sum: …, avg: … }) is *not* a type
  // error — excess-property checking against a union allows a key that exists on
  // another member. The builder rejects it at runtime instead; see
  // query-builder-aggregate.test.ts.

  it("rejects `integer_id` on a custom entity, where it aggregates to null", async () => {
    await client.creditNoteItem.aggregate({
      // @ts-expect-error — native column, unreadable via entity_field_instances
      metrics: { bad: { sum: "integer_id" } },
    });
  });

  it("allows `integer_id` on a system entity, where it is a native column", async () => {
    const result = await client.pyloUser.aggregate({
      metrics: { lowest: { min: "integer_id" } },
    });

    expectTypeOf(result.total.lowest).toEqualTypeOf<number | null>();
  });

  it("excludes integer_id from NumericFieldName only for custom entities", () => {
    expectTypeOf<NumericFieldName<MockSchema, "creditNoteItem">>().toEqualTypeOf<"amount">();
    expectTypeOf<NumericFieldName<MockSchema, "pyloUser">>().toEqualTypeOf<"integer_id">();
  });
});

describe("aggregate groupBy", () => {
  it("accepts a field name, a dotted relation path and a time bucket", async () => {
    const result = await client.creditNoteItem.aggregate({
      metrics: { n: "count" },
      groupBy: [
        "status",
        "credit_note.reference",
        { field: "created_at", interval: "1 day", timezone: "Europe/Berlin" },
      ],
    });

    expectTypeOf(result.rows[0]!.bucket).toEqualTypeOf<string>();
  });

  it("accepts plural and multi-unit intervals", async () => {
    await client.creditNoteItem.aggregate({
      metrics: { n: "count" },
      groupBy: [{ field: "created_at", interval: "15 minutes" }],
    });
  });

  it("rejects a malformed interval", async () => {
    await client.creditNoteItem.aggregate({
      metrics: { n: "count" },
      // @ts-expect-error — must be `<integer> <unit>`, e.g. "1 day"
      groupBy: [{ field: "created_at", interval: "daily" }],
    });
  });
});

describe("aggregate results", () => {
  it("types `total` from the metric keys", async () => {
    const result = await client.creditNoteItem.aggregate({
      metrics: { revenue: { sum: "amount" }, orders: "count" },
    });

    expectTypeOf(result.total).toEqualTypeOf<{
      revenue: number | null;
      orders: number | null;
    }>();
  });

  it("rejects an alias that was never requested", async () => {
    const result = await client.creditNoteItem.aggregate({
      metrics: { revenue: { sum: "amount" } },
    });

    // @ts-expect-error — `typo` is not one of the metric keys
    void result.total.typo;
  });

  it("collapses `rows` to the empty tuple without a groupBy", async () => {
    const result = await client.creditNoteItem.aggregate({
      metrics: { orders: "count" },
    });

    expectTypeOf(result.rows).toEqualTypeOf<[]>();
    // @ts-expect-error — the backend returns no rows here; read `total` instead
    void result.rows[0];
  });

  it("keys rows by the breakdown field and the metric aliases", async () => {
    const result = await client.creditNoteItem.aggregate({
      metrics: { orders: "count" },
      groupBy: ["status"],
    });

    // Not `"open" | "paid"`: grouping returns the enum value's UUID.
    expectTypeOf(result.rows[0]!.status).toEqualTypeOf<
      string | number | boolean | null
    >();
    expectTypeOf(result.rows[0]!.orders).toEqualTypeOf<number | null>();
  });

  it("keys a time bucket as `bucket`, typed string", async () => {
    const result = await client.creditNoteItem.aggregate({
      metrics: { orders: "count" },
      groupBy: [{ field: "created_at", interval: "1 month" }],
    });

    expectTypeOf(result.rows[0]!.bucket).toEqualTypeOf<string>();
  });
});

describe("aggregate sortby", () => {
  it("accepts a metric alias and a breakdown key", async () => {
    await client.creditNoteItem.aggregate({
      metrics: { revenue: { sum: "amount" } },
      groupBy: ["status"],
      filter: {
        sortby: [
          { field: "revenue", order: "desc" },
          { field: "status", order: "asc" },
        ],
      },
    });
  });

  it("rejects a key that is neither a metric nor a breakdown", async () => {
    await client.creditNoteItem.aggregate({
      metrics: { revenue: { sum: "amount" } },
      groupBy: ["status"],
      // @ts-expect-error — only aliases, dimension fields or "bucket" are sortable
      filter: { sortby: [{ field: "created_at", order: "asc" }] },
    });
  });
});

describe("the client surface", () => {
  it("exposes aggregate on a system entity", async () => {
    const result = await client.pyloUser.aggregate({ metrics: { users: "count" } });
    expectTypeOf(result.total.users).toEqualTypeOf<number | null>();
  });

  it("does not expose list on a system entity", () => {
    // @ts-expect-error — system entities have no list endpoint
    void client.pyloUser.list;
  });

  it("types count as a plain number", async () => {
    expectTypeOf(await client.creditNoteItem.count()).toEqualTypeOf<number>();
  });
});

describe("events.aggregate", () => {
  it("takes free-form property paths and types the total by alias", async () => {
    const result = await client.events.aggregate({
      metrics: { hits: "count", revenue: { sum: "order.total" } },
      groupBy: [{ interval: "1 day" }, "event_name"],
      startTime: "2026-07-01T00:00:00Z",
    });

    expectTypeOf(result.total).toEqualTypeOf<{
      hits: number | null;
      revenue: number | null;
    }>();
    expectTypeOf(result.rows[0]!.bucket).toEqualTypeOf<string>();
  });

  it("rejects a malformed interval", async () => {
    await client.events.aggregate({
      metrics: { hits: "count" },
      // @ts-expect-error — must be `<integer> <unit>`
      groupBy: [{ interval: "hourly" }],
    });
  });

  it("shares one result type with the entity surface", () => {
    // `AggregateRow` is an intersection of the metric and breakdown halves, so
    // compare the members rather than the whole (flattened) shape.
    const result = {} as AggregateResult<{ hits: "count" }, ["event_name"]>;

    expectTypeOf(result.total).toEqualTypeOf<{ hits: number | null }>();
    expectTypeOf(result.rows[0]!.hits).toEqualTypeOf<number | null>();
    expectTypeOf(result.rows[0]!.event_name).toEqualTypeOf<
      string | number | boolean | null
    >();
  });
});

import { describe, it, expect } from "vitest";
import {
  buildEntityAggregateQuery,
  buildEventAggregateQuery,
} from "../src/query-builder.js";

// Collapse whitespace so assertions don't depend on the builder's exact
// indentation/newlines.
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

// The `filter` variable both endpoints receive, typed loosely for assertions.
const filterOf = (variables: Record<string, unknown>) =>
  variables["filter"] as {
    aggregate: Array<{ function: string; field: string; alias?: string }>;
    dimensions?: Array<Record<string, unknown>>;
    query?: unknown;
    sortby?: unknown;
    limit?: unknown;
  };

describe("buildEntityAggregateQuery", () => {
  it("passes the entity name and selects rows + total", () => {
    const { query, variables } = buildEntityAggregateQuery("Order", {
      metrics: { n: "count" },
    });

    expect(norm(query)).toContain(
      "entityInstanceAggregate(entityName: $entityName, filter: $filter) { rows total }",
    );
    expect(variables["entityName"]).toBe("Order");
  });

  it("expands the `count` shorthand to the schema-required `*` field", () => {
    const { variables } = buildEntityAggregateQuery("Order", {
      metrics: { orders: "count" },
    });

    expect(filterOf(variables).aggregate).toEqual([
      { function: "count", field: "*", alias: "orders" },
    ]);
  });

  it("uses the record key as the alias — always sent, since the API demands one", () => {
    const { variables } = buildEntityAggregateQuery("Order", {
      metrics: { revenue: { sum: "amount" } },
    });

    expect(filterOf(variables).aggregate).toEqual([
      { function: "sum", field: "amount", alias: "revenue" },
    ]);
  });

  it("preserves metric order — the resolver's default sort keys off the first", () => {
    const { variables } = buildEntityAggregateQuery("Order", {
      metrics: { first: "count", second: { sum: "amount" }, third: { avg: "amount" } },
    });

    expect(filterOf(variables).aggregate.map((m) => m.alias)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("maps a string groupBy to a field dimension and an object to a time bucket", () => {
    const { variables } = buildEntityAggregateQuery("Order", {
      metrics: { n: "count" },
      groupBy: [
        "status",
        { field: "created_at", interval: "1 day", timezone: "Europe/Berlin" },
      ],
    });

    expect(filterOf(variables).dimensions).toEqual([
      { field: "status" },
      {
        timeBucket: {
          field: "created_at",
          interval: "1 day",
          timezone: "Europe/Berlin",
        },
      },
    ]);
  });

  it("keeps dotted relation paths verbatim", () => {
    const { variables } = buildEntityAggregateQuery("Order", {
      metrics: { n: "count" },
      groupBy: ["device_type.name"],
    });

    expect(filterOf(variables).dimensions).toEqual([{ field: "device_type.name" }]);
  });

  it("omits absent options rather than sending nulls", () => {
    const { variables } = buildEntityAggregateQuery("Order", {
      metrics: { n: "count" },
    });

    expect(Object.keys(filterOf(variables))).toEqual(["aggregate"]);
  });

  it("passes filter.query, filter.sortby and limit through", () => {
    const query = [{ condition: { field: "status", operator: "equal" as const, value: "paid" } }];
    const sortby = [{ field: "n", order: "desc" as const }];

    const { variables } = buildEntityAggregateQuery("Order", {
      metrics: { n: "count" },
      groupBy: ["status"],
      filter: { query, sortby },
      limit: 30,
    });

    const filter = filterOf(variables);
    expect(filter.query).toEqual(query);
    expect(filter.sortby).toEqual(sortby);
    expect(filter.limit).toBe(30);
  });

  it("requires a time bucket field — entities have no default column", () => {
    expect(() =>
      buildEntityAggregateQuery("Order", {
        metrics: { n: "count" },
        groupBy: [{ interval: "1 day" }],
      }),
    ).toThrow(/time bucket requires a 'field'/);
  });

  it("rejects a metric with no aggregate function", () => {
    expect(() =>
      buildEntityAggregateQuery("Order", { metrics: { n: {} } }),
    ).toThrow(/exactly one aggregate function/);
  });

  it("rejects a metric with two aggregate functions", () => {
    // Not a type error — excess-property checking against a union permits a key
    // belonging to another member — so the runtime guard is the only one.
    expect(() =>
      buildEntityAggregateQuery("Order", {
        metrics: { n: { sum: "amount", avg: "amount" } },
      }),
    ).toThrow(/exactly one aggregate function/);
  });

  it("rejects an unknown aggregate function", () => {
    expect(() =>
      buildEntityAggregateQuery("Order", { metrics: { n: { median: "amount" } } }),
    ).toThrow(/unknown aggregate function "median"/);
  });

  it("rejects an empty metrics object", () => {
    expect(() => buildEntityAggregateQuery("Order", { metrics: {} })).toThrow(
      /at least one metric/,
    );
  });
});

describe("buildEventAggregateQuery", () => {
  it("selects data + aggregations from pyloEventList", () => {
    const { query } = buildEventAggregateQuery({ metrics: { hits: "count" } });

    expect(norm(query)).toContain("pyloEventList(");
    expect(norm(query)).toContain("data aggregations");
  });

  it("defaults a time bucket field to the native `ts` column", () => {
    const { variables } = buildEventAggregateQuery({
      metrics: { hits: "count" },
      groupBy: [{ interval: "1 day" }],
    });

    expect(filterOf(variables).dimensions).toEqual([
      { timeBucket: { field: "ts", interval: "1 day" } },
    ]);
  });

  it("shrinks the unread data page when there is no breakdown", () => {
    // Ungrouped, the endpoint stays in list mode and runs a paged data query
    // beside the aggregation. Nothing reads those rows.
    const { query, variables } = buildEventAggregateQuery({
      metrics: { hits: "count" },
    });

    expect(variables["pagination"]).toEqual({ page: 1, per_page: 1 });
    expect(variables["select_fields"]).toEqual(["ts"]);
    expect(norm(query)).toContain("pagination: $pagination");
  });

  it("drops the page guard once a breakdown is requested", () => {
    const { query, variables } = buildEventAggregateQuery({
      metrics: { hits: "count" },
      groupBy: ["event_name"],
    });

    expect(variables["pagination"]).toBeUndefined();
    expect(variables["select_fields"]).toBeUndefined();
    expect(norm(query)).not.toContain("$pagination");
  });

  it("passes startTime through as its own argument", () => {
    const { query, variables } = buildEventAggregateQuery({
      metrics: { hits: "count" },
      groupBy: ["event_name"],
      startTime: "2026-07-01T00:00:00Z",
    });

    expect(variables["startTime"]).toBe("2026-07-01T00:00:00Z");
    expect(norm(query)).toContain("startTime: $startTime");
  });
});

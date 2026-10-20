import { describe, it, expect } from "vitest";
import { buildSubscriptionMutation } from "../src/mutation-builder.js";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

const base = {
  connectionId: "c1",
  onCreate: true,
  onUpdate: true,
  onDelete: false,
};

describe("buildSubscriptionMutation", () => {
  it("registers the selection as the event projection, always with id", () => {
    const { query, variables, field } = buildSubscriptionMutation("deviceType", {
      ...base,
      select: { name: true },
      filter: { query: [{ condition: { field: "name", operator: "ilike", value: "a%" } }] },
    });

    expect(field).toBe("upsertDeviceTypeSubscription");
    expect(norm(query)).toContain(
      "mutation UpsertDeviceTypeSubscription($subscription: SubscriptionInput, $filter: FilterInput)",
    );
    expect(norm(query)).toContain(
      "upsertDeviceTypeSubscription(subscription: $subscription, filter: $filter)",
    );
    expect(norm(query)).toContain("subscription { webserviceUrl connectionId id }");
    expect(norm(query)).toContain("fields { name id }");
    expect(variables).toEqual({
      subscription: { connectionId: "c1", onCreate: true, onUpdate: true, onDelete: false },
      filter: { query: [{ condition: { field: "name", operator: "ilike", value: "a%" } }] },
    });
  });

  it("passes the server id to update a subscription in place", () => {
    const { variables } = buildSubscriptionMutation("contact", {
      ...base,
      id: "s1",
      select: { id: true },
    });
    expect(variables).toEqual({ subscription: { id: "s1", ...base } });
  });

  // The server replays the selection in its own query, where variables don't exist.
  it("writes relation arguments as literals, with enums unquoted", () => {
    const { query, variables } = buildSubscriptionMutation("contact", {
      ...base,
      select: {
        name_variants: true,
        orders: {
          select: { total: true, _pagination: { total: true } },
          filter: {
            query: [{ condition: { field: "status", operator: "in", values: ["open", 'a"b'] } }],
            sortby: [{ field: "created_at", order: "desc" }],
          },
          pagination: { page: 1, per_page: 3 },
        },
      },
    });

    expect(norm(query)).toContain(
      'orders(filter: { query: [{ condition: { field: "status", operator: in, values: ["open", "a\\"b"] } }], sortby: [{ field: "created_at", order: desc }] }, pagination: { page: 1, per_page: 3 }) { data { total } pagination { total } }',
    );
    expect(norm(query)).toContain("name_variants { data { value variant is_default } }");
    expect(query).not.toContain("$r_");
    expect(Object.keys(variables)).toEqual(["subscription"]);
  });

  it("rejects an enum value that would inject into the query", () => {
    expect(() =>
      buildSubscriptionMutation("contact", {
        ...base,
        select: {
          orders: {
            select: { id: true },
            filter: { query: [{ condition: { field: "x", operator: "in) { id } #" } }] },
          },
        },
      }),
    ).toThrow(/Invalid enum value/);
  });

  it("requires a selection", () => {
    expect(() => buildSubscriptionMutation("contact", { ...base, select: {} })).toThrow(
      /subscribe\("contact"\) requires an explicit 'select'/,
    );
  });
});

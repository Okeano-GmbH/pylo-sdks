import { describe, it, expect } from "vitest";
import type { RealtimeEvent } from "@pylo/core";
import { applyListEvent, applyPagesEvent, applyRowEvent } from "../src/live.js";

const update = (id: string, data: Record<string, unknown>): RealtimeEvent => ({
  kind: "update",
  id,
  removed: false,
  data: { id, ...data },
});
const create = (id: string, data: Record<string, unknown>): RealtimeEvent => ({
  kind: "create",
  id,
  removed: false,
  data: { id, ...data },
});
const removed = (id: string, kind: "update" | "delete" = "delete"): RealtimeEvent => ({
  kind,
  id,
  removed: true,
});

const list = () => ({
  data: [
    { id: "a", name: "Ada", rank: 1 },
    { id: "b", name: "Bea", rank: 2 },
  ],
  pagination: { total: 2 },
});

describe("applyRowEvent", () => {
  it("replaces the row with the event's projection", () => {
    expect(applyRowEvent({ id: "a", name: "Ada" }, update("a", { name: "Ann" }))).toEqual({
      data: { id: "a", name: "Ann" },
      refetch: false,
    });
  });

  it("clears the row when it is removed", () => {
    expect(applyRowEvent({ id: "a" }, removed("a"))).toEqual({ data: null, refetch: false });
  });

  it("fills a row that did not exist yet", () => {
    expect(applyRowEvent(null, create("a", { name: "Ada" })).data).toEqual({ id: "a", name: "Ada" });
  });
});

describe("applyListEvent", () => {
  it("merges an update in place when no sort field changed", () => {
    const result = applyListEvent(list(), update("b", { name: "Bo" }), [{ field: "rank", order: "asc" }]);
    expect(result.refetch).toBe(false);
    expect(result.data.data[1]).toEqual({ id: "b", name: "Bo", rank: 2 });
  });

  it("refetches soon instead of merging when a sort field changed", () => {
    const before = list();
    const result = applyListEvent(before, update("a", { rank: 9 }), [{ field: "rank", order: "asc" }]);
    expect(result).toEqual({ data: before, refetch: "soon" });
  });

  it("merges and refetches later when the sort field isn't in the projection", () => {
    const result = applyListEvent(list(), update("a", { name: "Ann" }), [
      { field: "missing", order: "asc" },
    ]);
    expect(result.refetch).toBe("later");
    expect(result.data.data[0]!["name"]).toBe("Ann");
  });

  it("ignores immutable sort fields", () => {
    const result = applyListEvent(list(), update("a", { name: "Ann" }), [
      { field: "created_at", order: "desc" },
    ]);
    expect(result.refetch).toBe(false);
  });

  it("compares sort paths through relation envelopes", () => {
    const rows = {
      data: [{ id: "a", company: { data: { name: "X" } } }],
    };
    const sortby = [{ field: "company.name", order: "asc" as const }];
    expect(applyListEvent(rows, update("a", { company: { data: { name: "X" } } }), sortby).refetch).toBe(
      false,
    );
    expect(applyListEvent(rows, update("a", { company: { data: { name: "Y" } } }), sortby).refetch).toBe(
      "soon",
    );
  });

  it("removes a row and still rebalances pages in the background", () => {
    const result = applyListEvent(list(), removed("a", "update"), undefined);
    expect(result.data.data.map((r) => r.id)).toEqual(["b"]);
    expect(result.data.pagination).toEqual({ total: 1 });
    expect(result.refetch).toBe("later");
  });

  it("ignores the removal of a row it doesn't hold", () => {
    const before = list();
    expect(applyListEvent(before, removed("z"), undefined)).toEqual({ data: before, refetch: false });
  });

  it("prepends a create under newest-first sorting", () => {
    for (const sortby of [undefined, [{ field: "created_at", order: "desc" as const }]]) {
      const result = applyListEvent(list(), create("c", { name: "Cy" }), sortby);
      expect(result.refetch).toBe(false);
      expect(result.data.data[0]).toEqual({ id: "c", name: "Cy" });
      expect(result.data.pagination).toEqual({ total: 3 });
    }
  });

  it("leaves a create under any other sort to the server", () => {
    const before = list();
    const result = applyListEvent(before, create("c", {}), [{ field: "name", order: "asc" }]);
    expect(result).toEqual({ data: before, refetch: "later" });
  });

  it("leaves a row entering the filter to the server", () => {
    const before = list();
    expect(applyListEvent(before, update("c", { name: "Cy" }), undefined)).toEqual({
      data: before,
      refetch: "later",
    });
  });

  it("keeps lists without pagination intact", () => {
    const result = applyListEvent({ data: [{ id: "a" }] }, create("c", {}), undefined);
    expect(result.data).toEqual({ data: [{ id: "c" }, { id: "a" }] });
  });
});

describe("applyPagesEvent", () => {
  const pages = () => ({
    pages: [
      { data: [{ id: "a" }, { id: "b" }], pagination: { total: 4, current_page: 1 } },
      { data: [{ id: "c", name: "Cy" }, { id: "d" }], pagination: { total: 4, current_page: 2 } },
    ],
    pageParams: [1, 2],
  });

  it("updates a row on a later page", () => {
    const before = pages();
    const result = applyPagesEvent(before, update("c", { name: "Cyd" }), undefined);
    expect(result.data.pages[1]!.data[0]).toEqual({ id: "c", name: "Cyd" });
    expect(result.data.pages[0]).toBe(before.pages[0]);
  });

  it("removes from the page holding the row and adjusts the total on the first", () => {
    const result = applyPagesEvent(pages(), removed("c"), undefined);
    expect(result.data.pages[1]!.data.map((r) => r.id)).toEqual(["d"]);
    expect(result.data.pages[1]!.pagination).toEqual({ total: 4, current_page: 2 });
    expect(result.refetch).toBe("later");
  });

  it("prepends a create to the first page", () => {
    const result = applyPagesEvent(pages(), create("z", {}), undefined);
    expect(result.data.pages[0]!.data.map((r) => r.id)).toEqual(["z", "a", "b"]);
    expect(result.data.pages[0]!.pagination).toEqual({ total: 5, current_page: 1 });
    expect(result.data.pageParams).toEqual([1, 2]);
  });
});

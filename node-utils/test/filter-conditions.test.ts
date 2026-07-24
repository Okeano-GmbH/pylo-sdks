import { describe, it, expect } from "vitest";
import {
  evaluateConditionTree,
  type FilterOperatorsType,
} from "../src/filter-conditions.js";

/** Evaluate a single `field <op> value` against a one-key state. */
const evalOne = (
  fieldValue: unknown,
  operator: FilterOperatorsType,
  value: unknown
) =>
  evaluateConditionTree(
    { condition: { field: "f", operator, value: value as string } },
    { f: fieldValue }
  );

describe("date-aware ordering", () => {
  it("orders a date-only value against a timestamp", () => {
    // Was broken: "2026-07-23" is a lexicographic prefix of the timestamp.
    expect(
      evalOne("2026-07-23", "greaterThanOrEqual", "2026-07-23T00:00:00.000Z")
    ).toBe(true);
    expect(evalOne("2026-07-23", "lessThan", "2026-07-23T00:00:00.000Z")).toBe(
      false
    );
    expect(
      evalOne("2026-07-23T14:30:00.000Z", "greaterThan", "2026-07-23")
    ).toBe(true);
  });

  it("ignores fractional-second width (3-digit ms vs 6-digit micros)", () => {
    expect(
      evalOne(
        "2026-07-23T14:30:00.279000Z",
        "greaterThan",
        "2026-07-23T14:30:00.279Z"
      )
    ).toBe(false);
    expect(
      evalOne(
        "2026-07-23T14:30:00.279000Z",
        "greaterThanOrEqual",
        "2026-07-23T14:30:00.279Z"
      )
    ).toBe(true);
  });

  it("orders datetimes chronologically", () => {
    expect(
      evalOne(
        "2026-07-24T10:00:00.000Z",
        "greaterThan",
        "2026-07-23T00:00:00.000Z"
      )
    ).toBe(true);
    expect(
      evalOne(
        "2026-07-22T23:59:59.999Z",
        "greaterThan",
        "2026-07-23T00:00:00.000Z"
      )
    ).toBe(false);
  });

  it("honours UTC offsets", () => {
    // 10:21+02:00 is the same instant as 08:21Z.
    expect(
      evalOne(
        "2026-07-23T10:21:28.000+02:00",
        "greaterThan",
        "2026-07-23T08:21:28.000Z"
      )
    ).toBe(false);
    expect(
      evalOne(
        "2026-07-23T10:21:28.000+0200",
        "lessThanOrEqual",
        "2026-07-23T08:21:28.000Z"
      )
    ).toBe(true);
  });

  it("maps over an array field (e.g. relation ids are per-item dates)", () => {
    expect(
      evalOne(
        ["2026-07-20", "2026-07-25"],
        "greaterThan",
        "2026-07-23T00:00:00.000Z"
      )
    ).toBe(true);
  });
});

describe("ordering does not depend on the host timezone", () => {
  // `Date.parse` reads a naive date-time as local time but a date-only string
  // as UTC, so these answers differed between a Berlin server and a UTC
  // container. Every operand with no `Z`/offset is now read as UTC.
  it("reads a naive date-time as UTC", () => {
    expect(evalOne("2026-07-23T00:00:00", "greaterThan", "2026-07-23")).toBe(
      false
    );
    expect(
      evalOne("2026-07-23T00:00:00", "lessThanOrEqual", "2026-07-23")
    ).toBe(true);
  });

  it("reads a Postgres space-separated stamp as UTC", () => {
    expect(
      evalOne("2026-07-23 10:00:00", "greaterThan", "2026-07-23T09:30:00Z")
    ).toBe(true);
    expect(
      evalOne("2026-07-23 08:21:28.000", "lessThanOrEqual", "2026-07-23T08:21:28.000Z")
    ).toBe(true);
  });
});

describe("equality is untouched", () => {
  it("keeps strict equality for dates, so serialization must match", () => {
    expect(evalOne("2026-07-23", "equal", "2026-07-23")).toBe(true);
    expect(evalOne("2026-07-23", "equal", "2026-07-23T00:00:00.000Z")).toBe(
      false
    );
    expect(evalOne(5, "equal", 5)).toBe(true);
  });
});

describe("non-date comparisons keep raw semantics", () => {
  it("does not treat plain numeric strings as dates", () => {
    // "10" / "9" must NOT parse as dates — raw string comparison stands.
    expect(evalOne("10", "greaterThan", "9")).toBe(false);
  });

  it("compares real numbers numerically", () => {
    expect(evalOne(5, "greaterThan", 3)).toBe(true);
    expect(evalOne(5, "equal", 5)).toBe(true);
  });

  it("keeps plain-string equality strict", () => {
    expect(evalOne("hello", "equal", "hello")).toBe(true);
    expect(evalOne("hello", "equal", "world")).toBe(false);
  });
});

describe("safety: never throws", () => {
  it("falls back to raw comparison for date-shaped but unparseable values", () => {
    // Date-shaped, so Date.parse -> NaN; must fall back, not throw.
    expect(() =>
      evalOne("2026-13-45", "greaterThan", "2026-07-23")
    ).not.toThrow();
    expect(
      evalOne("2026-07-23T25:00:00Z", "greaterThan", "2026-07-24T01:00:00Z")
    ).toBe(false);
    expect(
      evalOne("2026-07-23T00:61:00Z", "lessThan", "2026-07-23T01:01:00Z")
    ).toBe(true); // lexicographic fallback
  });

  it("handles null / undefined field values", () => {
    expect(() => evalOne(null, "greaterThan", "2026-07-23")).not.toThrow();
    expect(() => evalOne(undefined, "equal", "2026-07-23")).not.toThrow();
    expect(evalOne(null, "isEmpty", "")).toBe(true);
  });
});

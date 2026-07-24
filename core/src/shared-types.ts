// Shared types used by both codegen output and runtime SDK.
// These never change per schema.

// Mutation field suffixes for relations. hasOne relations only support `_set`.
// hasMany relations also take a pair for attaching/detaching rows, which the
// schema names `_connect`/`_disconnect` — except between two Pylo system
// entities, where it is `_add`/`_remove`.
export const RELATION_SUFFIXES = [
  "_set",
  "_connect",
  "_disconnect",
  "_add",
  "_remove",
] as const;
export type RelationSuffix = (typeof RELATION_SUFFIXES)[number];

export type QueryOperator =
  | "equal"
  | "notEqual"
  | "greaterThan"
  | "lessThan"
  | "greaterThanOrEqual"
  | "lessThanOrEqual"
  | "isNull"
  | "isNotNull"
  | "like"
  | "notLike"
  | "ilike"
  | "notiLike"
  | "regex"
  | "notRegex"
  | "iregex"
  | "notiRegex"
  | "in"
  | "notIn"
  | "isEmpty"
  | "isNotEmpty"
  | "isTrue"
  | "isFalse";

export type SortOrder = "asc" | "desc";

export interface QueryInputCondition {
  field: string;
  operator: QueryOperator;
  value?: string | number;
  values?: Array<string | number>;
}

export interface QueryInput {
  and?: QueryInput[];
  or?: QueryInput[];
  condition?: QueryInputCondition;
}

export interface SortInput {
  field: string;
  order: SortOrder;
}

export interface FilterInput {
  query?: QueryInput[];
  sortby?: SortInput[];
}

export interface PaginationInput {
  page?: number;
  per_page?: number;
}

export interface PaginationData {
  total: number;
  current_page: number;
  per_page: number;
  last_page: number;
  has_more_pages: boolean;
}

export interface SearchValueInput {
  field: string;
  value?: string;
  not_found_behavior?: "create" | "ignore" | "error";
  search_in_all_field_variants?: boolean;
  multiple_results_allowed?: boolean;
  multiple_results_use_latest?: boolean;
}

// Event ingestion. The backend namespaces all ingested events under
// "custom." (a missing prefix is added server-side) and generates `ts` itself.
export interface PyloEventInput {
  event_name: string;
  properties: Record<string, unknown>;
}

export interface PyloEvent {
  event_name: string;
  ts: string;
  properties: Record<string, unknown>;
}

// Event querying. The event store is a flat ClickHouse table; `properties` is a
// JSON blob queried via dotted paths (e.g. `properties.user.id`, or just
// `user.id` — the `properties.` prefix is added server-side). Top-level columns
// are `event_name`, `ts`, `source`, `pylo_app_id`, `properties`.

export type AggregateFunction = "count" | "sum" | "avg" | "min" | "max";

export interface AggregateInput {
  field: string;
  function: AggregateFunction;
  alias?: string;
}

export interface TimeBucketInput {
  // Datetime field to bucket. Defaults to the native `ts` column; a dotted
  // property path holding an ISO-8601 string is also valid.
  field?: string;
  // Bucket stride, e.g. "5 minute", "1 day", "1 month".
  interval: string;
  // IANA timezone (e.g. "Europe/Berlin"). Defaults to "UTC".
  timezone?: string;
}

// A single breakdown axis. Set exactly one of `field` or `timeBucket`.
export interface DimensionInput {
  field?: string;
  timeBucket?: TimeBucketInput;
}

export interface EventListFilterInput {
  query?: QueryInput[];
  sortby?: SortInput[];
  // Metrics to compute. Emitted in the grand-total `aggregations`, and per-group
  // when `dimensions` (or the legacy `group_by` / `interval`) are set.
  aggregate?: AggregateInput[];
  // Ordered breakdown axes: [0] is the primary axis, [1] the series breakdown.
  // When set, takes precedence over the top-level `interval` / `group_by`.
  dimensions?: DimensionInput[];
  // Cap on returned grouped rows (after sort). No effect on `aggregations`.
  limit?: number;
}

export interface EventListOptions {
  filter?: EventListFilterInput;
  pagination?: PaginationInput;
  // Restrict the returned columns in list mode (top-level columns or dotted
  // property paths). Ignored in grouped/analytics mode.
  select_fields?: string[];
  // Legacy grouped-mode args. Prefer `filter.dimensions`. Presence of either
  // `interval` or `group_by` switches the query into grouped/analytics mode.
  interval?: string;
  timezone?: string;
  group_by?: string[];
  // ISO-8601 lower bound on `ts` (convenience for the common time filter).
  startTime?: string;
}

// Rows are plain JSON objects. In list mode: `{ event_name, ts, properties, ... }`
// (or just the `select_fields`). In grouped mode: one row per group with the
// dimension keys (or `bucket` for a time bucket) plus the metric aliases.
export interface PyloEventListResult {
  data: Array<Record<string, unknown>>;
  pagination: PaginationData;
  // Grand total over the full filtered set; `{ <alias>: number, ... }` or null
  // when no `aggregate` metrics were requested.
  aggregations: Record<string, unknown> | null;
}

// An inferred property path and its JSON type, derived from recent events.
export interface PyloEventProperty {
  path: string;
  type: string;
}

// A distinct value of a field and how often it occurs, most frequent first.
export interface PyloEventFieldValue {
  value: string;
  count: number;
}

export interface PyloEventPropertyKeysOptions {
  filter?: FilterInput;
}

export interface PyloEventFieldValuesOptions {
  startTime?: string;
  limit?: number;
}

//
// Aggregates
//
// Pylo aggregates two stores — entities via `entityInstanceAggregate` and events
// via `pyloEventList` — and the SDK reaches both through one idiom:
//
//   metrics: { revenue: { sum: "amount" }, orders: "count" }
//   groupBy: [{ field: "created_at", interval: "1 month" }, "status"]
//
// `metrics` is keyed by alias because the backend *requires* an alias on every
// metric (both resolvers reject a missing one, despite the schema marking it
// optional) and requires it to be a unique identifier. Keying by it makes
// duplicates impossible and lets the result type be read back off `keyof`.
//
// The builders translate this to the backend's `AggregateInput[]` /
// `DimensionInput[]` arrays. The types below are the parts that don't depend on
// a generated schema; `types.ts` adds the entity-specific field constraints.

// A metric value as it reaches the caller. The API is inconsistent about the
// wire type — `count` arrives as a JSON number, but `sum`/`avg`/`min`/`max` over
// a custom entity arrive as strings (Postgres `numeric` through PDO, e.g.
// "10.815217391304348"). The client coerces both to `number`, so this type holds
// after that step. `null` is a genuine result: an aggregate over zero rows.
export type MetricValue = number | null;

// A breakdown value. Deliberately *not* the field's declared type: grouping by
// an enum field returns the enum value's UUID rather than the value itself
// (reading the same field through `list`/`byId` returns e.g. "open"), so
// promising the enum union here would be wrong. Time buckets are ISO 8601.
export type DimensionValue = string | number | boolean | null;

export type AggregateIntervalUnit =
  | "second"
  | "minute"
  | "hour"
  | "day"
  | "week"
  | "month"
  | "quarter"
  | "year";

// Bucket stride: `<integer> <unit>`, plural tolerated. The backend additionally
// requires a multiplier of 1 for `month`/`quarter`/`year` (calendar units aren't
// fixed-stride) — not expressible here, so it stays a runtime error.
export type AggregateInterval =
  | `${number} ${AggregateIntervalUnit}`
  | `${number} ${AggregateIntervalUnit}s`;

// The row key a breakdown axis contributes: a plain string axis keys the row by
// that field/path verbatim, a time bucket is always keyed `bucket`.
export type RowKeyOf<G> = G extends string
  ? G
  : G extends { interval: unknown }
    ? "bucket"
    : never;

// Keys a result sort may reference: a metric alias or a breakdown key. Matches
// what both resolvers validate against.
export type AggregateSortKey<M, G extends readonly unknown[]> =
  | (keyof M & string)
  | RowKeyOf<G[number]>;

export interface AggregateSortInput<M, G extends readonly unknown[]> {
  field: AggregateSortKey<M, G>;
  order: SortOrder;
}

// Narrows the rows *before* aggregation. Same `QueryInput` tree as list queries;
// `sortby` orders the returned groups.
export interface AggregateFilterInput<M, G extends readonly unknown[]> {
  query?: QueryInput[];
  sortby?: Array<AggregateSortInput<M, G>>;
}

// Grand total over the full filtered set, ignoring any breakdown.
//
// `-readonly` strips the modifier that `const` type parameters put on the
// inferred `metrics` literal: the options object is read-only, the result the
// caller gets back is not.
export type AggregateTotal<M> = { -readonly [A in keyof M]: MetricValue };

export type AggregateRow<M, G extends readonly unknown[]> = AggregateTotal<M> & {
  [K in RowKeyOf<G[number]>]: K extends "bucket" ? string : DimensionValue;
};

// Without a breakdown the backend returns no rows at all, so the type collapses
// to the empty tuple — indexing it is then a compile error that points the
// caller at `total` instead of handing them a silently empty array.
export type AggregateRows<M, G extends readonly unknown[]> = G extends readonly []
  ? []
  : Array<AggregateRow<M, G>>;

export interface AggregateResult<M, G extends readonly unknown[]> {
  rows: AggregateRows<M, G>;
  total: AggregateTotal<M>;
}

// Events are schemaless, so metric fields are plain strings: a top-level column
// (`event_name`, `ts`, `source`) or a dotted property path (`order.total`).
export type EventMetricInput =
  | "count"
  | { count: string }
  | { sum: string }
  | { avg: string }
  | { min: string }
  | { max: string };

// A plain string groups by that column/property path; an object is a time
// bucket, whose `field` defaults to the native `ts` column.
export type EventGroupByInput =
  | string
  | { field?: string; interval: AggregateInterval; timezone?: string };

export interface EventAggregateOptions<
  M extends Record<string, EventMetricInput>,
  G extends readonly EventGroupByInput[],
> {
  metrics: M;
  groupBy?: G;
  filter?: AggregateFilterInput<M, G>;
  // Cap on returned grouped rows (after sort). No effect on `total`.
  limit?: number;
  // ISO-8601 lower bound on `ts` — a convenience for the common time filter.
  startTime?: string;
}

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

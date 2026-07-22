import type {
  EventListOptions,
  EventListFilterInput,
  PyloEventPropertyKeysOptions,
  PyloEventFieldValuesOptions,
} from "./shared-types.js";

interface BuildResult {
  query: string;
  variables: Record<string, unknown>;
}

interface RelationSelect {
  select?: SelectObject;
  filter?: unknown;
  pagination?: unknown;
}

interface SelectObject {
  [key: string]: true | RelationSelect;
}

// Variant fields are codegen-named with this suffix and must be queried as
// `field { data { value variant } }` rather than as a bare scalar.
const VARIANT_SUFFIX = "_variants";

// Runtime option types — accept `unknown` since type safety is at the SDK layer
interface ListOptionsInput {
  select?: unknown;
  filter?: unknown;
  pagination?: unknown;
}

interface ByIdOptionsInput {
  select?: unknown;
}

const PAGINATION_FIELDS = `pagination {
    total
    current_page
    per_page
    last_page
    has_more_pages
  }`;

// Builds a GraphQL selection set from a runtime `select` object, using
// conventions instead of schema metadata:
//   - `key: true`              → a scalar field, or a variant field when the
//                                key ends in `_variants` (emitted with its
//                                `{ data { value variant } }` sub-selection).
//   - `key: { select, … }`     → a relation; emitted as `key { data { … } }`,
//                                with a `pagination { … }` block only when a
//                                `pagination` key is supplied (opt-in, so the
//                                runtime needn't know hasOne vs hasMany).
function buildSelectionSet(
  select: SelectObject,
  variables: Record<string, unknown>,
  variableTypes: Map<string, string>,
  prefix: string,
): string {
  const fields: string[] = [];

  for (const [key, value] of Object.entries(select)) {
    if (value === true) {
      if (key.endsWith(VARIANT_SUFFIX)) {
        fields.push(`${key} { data { value variant } }`);
      } else {
        fields.push(key);
      }
      continue;
    }

    if (typeof value !== "object" || value === null) continue;

    const relation = value as RelationSelect;
    const argParts: string[] = [];

    // Handle filter argument
    if (relation.filter !== undefined) {
      const varName = `${prefix}${key}_filter`;
      variables[varName] = relation.filter;
      variableTypes.set(varName, "FilterInput");
      argParts.push(`filter: $${varName}`);
    }

    // Pagination is opt-in: its presence both passes the argument and adds the
    // `pagination { … }` response block.
    const wantsPagination = relation.pagination !== undefined;
    if (wantsPagination) {
      const varName = `${prefix}${key}_pagination`;
      variables[varName] = relation.pagination;
      variableTypes.set(varName, "PaginationInput");
      argParts.push(`pagination: $${varName}`);
    }

    const args = argParts.length > 0 ? `(${argParts.join(", ")})` : "";

    if (!relation.select) {
      throw new Error(`Relation "${key}" requires an explicit { select: {...} }.`);
    }

    const nestedSelection = buildSelectionSet(
      relation.select,
      variables,
      variableTypes,
      `${prefix}${key}_`,
    );

    if (wantsPagination) {
      fields.push(`${key}${args} { data { ${nestedSelection} } ${PAGINATION_FIELDS} }`);
    } else {
      fields.push(`${key}${args} { data { ${nestedSelection} } }`);
    }
  }

  return fields.join("\n    ");
}

function requireSelect(
  entityKey: string,
  operation: string,
  select: unknown,
): SelectObject {
  if (
    !select ||
    typeof select !== "object" ||
    Object.keys(select as object).length === 0
  ) {
    throw new Error(`${operation}("${entityKey}") requires an explicit 'select'.`);
  }
  return select as SelectObject;
}

export function buildListQuery(
  entityKey: string,
  options: ListOptionsInput | undefined,
): BuildResult {
  const select = requireSelect(entityKey, "list", options?.select);

  const variables: Record<string, unknown> = {};
  const variableTypes = new Map<string, string>();

  // Top-level filter and pagination
  if (options?.filter !== undefined) {
    variables["filter"] = options.filter;
    variableTypes.set("filter", "FilterInput");
  }
  if (options?.pagination !== undefined) {
    variables["pagination"] = options.pagination;
    variableTypes.set("pagination", "PaginationInput");
  }

  const selectionSet = buildSelectionSet(select, variables, variableTypes, "r_");

  // Build variable declarations
  const varDecls = Array.from(variableTypes.entries())
    .map(([name, type]) => `$${name}: ${type}`)
    .join(", ");

  const varSection = varDecls ? `(${varDecls})` : "";

  // Build argument list for the query field
  const argParts: string[] = [];
  if (variableTypes.has("filter")) {
    argParts.push("filter: $filter");
  }
  if (variableTypes.has("pagination")) {
    argParts.push("pagination: $pagination");
  }
  const argSection = argParts.length > 0 ? `(${argParts.join(", ")})` : "";

  const queryName = `${entityKey}List`;

  const query = `query ${capitalize(entityKey)}List${varSection} {
  ${queryName}${argSection} {
    data {
      ${selectionSet}
    }
    ${PAGINATION_FIELDS}
  }
}`;

  return { query, variables };
}

export function buildByIdQuery(
  entityKey: string,
  id: string,
  options: ByIdOptionsInput | undefined,
): BuildResult {
  const select = requireSelect(entityKey, "byId", options?.select);

  const variables: Record<string, unknown> = { id };
  const variableTypes = new Map<string, string>([["id", "ID!"]]);

  const selectionSet = buildSelectionSet(select, variables, variableTypes, "r_");

  const varDecls = Array.from(variableTypes.entries())
    .map(([name, type]) => `$${name}: ${type}`)
    .join(", ");

  const query = `query ${capitalize(entityKey)}ById(${varDecls}) {
  ${entityKey}ById(id: $id) {
    data {
      ${selectionSet}
    }
  }
}`;

  return { query, variables };
}

// Recovers an entity's PascalName from its camelCase key — the exact inverse of
// codegen's `toEntityKey` (which only lowercases the first char). Used for
// mutation field names (`update${PascalName}` / `delete${PascalName}`) so the
// runtime no longer needs schema metadata to look up `pascalName`.
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Maps each pyloEventList argument to its GraphQL type. Only the args actually
// present on the options object are declared/passed, so the query stays minimal.
const EVENT_LIST_ARG_TYPES: Record<keyof EventListOptions, string> = {
  filter: "EventListFilterInput",
  pagination: "PaginationInput",
  select_fields: "[String!]",
  interval: "String",
  timezone: "String",
  group_by: "[String!]",
  startTime: "String",
};

const EVENT_LIST_DATA = `data
    pagination {
      total
      current_page
      per_page
      last_page
      has_more_pages
    }
    aggregations`;

// The backend schema declares `TimeBucketInput.field` as required (`String!`),
// even though the resolver defaults a missing field to the native `ts` column.
// GraphQL validates against the schema before the resolver runs, so we inject
// the same `ts` default here — keeping `field` ergonomically optional in the SDK
// while still emitting a schema-valid query.
function normalizeEventFilter(filter: EventListFilterInput): EventListFilterInput {
  if (!filter.dimensions?.length) return filter;

  const dimensions = filter.dimensions.map((dim) =>
    dim.timeBucket && dim.timeBucket.field === undefined
      ? { ...dim, timeBucket: { ...dim.timeBucket, field: "ts" } }
      : dim,
  );

  return { ...filter, dimensions };
}

export function buildEventListQuery(
  options?: EventListOptions,
): BuildResult {
  const variables: Record<string, unknown> = {};
  const varDecls: string[] = [];
  const argParts: string[] = [];

  for (const key of Object.keys(EVENT_LIST_ARG_TYPES) as Array<keyof EventListOptions>) {
    const value = options?.[key];
    if (value === undefined) continue;
    variables[key] = key === "filter" ? normalizeEventFilter(value as EventListFilterInput) : value;
    varDecls.push(`$${key}: ${EVENT_LIST_ARG_TYPES[key]}`);
    argParts.push(`${key}: $${key}`);
  }

  const varSection = varDecls.length > 0 ? `(${varDecls.join(", ")})` : "";
  const argSection = argParts.length > 0 ? `(${argParts.join(", ")})` : "";

  const query = `query PyloEventList${varSection} {
  pyloEventList${argSection} {
    ${EVENT_LIST_DATA}
  }
}`;

  return { query, variables };
}

export function buildEventPropertyKeysQuery(
  options?: PyloEventPropertyKeysOptions,
): BuildResult {
  const hasFilter = options?.filter !== undefined;
  const varSection = hasFilter ? "($filter: FilterInput)" : "";
  const argSection = hasFilter ? "(filter: $filter)" : "";

  const query = `query PyloEventPropertyKeys${varSection} {
  pyloEventPropertyKeys${argSection} {
    path
    type
  }
}`;

  return {
    query,
    variables: hasFilter ? { filter: options!.filter } : {},
  };
}

export function buildEventFieldValuesQuery(
  field: string,
  options?: PyloEventFieldValuesOptions,
): BuildResult {
  const varDecls = ["$field: String!"];
  const argParts = ["field: $field"];
  const variables: Record<string, unknown> = { field };

  if (options?.startTime !== undefined) {
    varDecls.push("$startTime: String");
    argParts.push("startTime: $startTime");
    variables["startTime"] = options.startTime;
  }
  if (options?.limit !== undefined) {
    varDecls.push("$limit: Int");
    argParts.push("limit: $limit");
    variables["limit"] = options.limit;
  }

  const query = `query PyloEventFieldValues(${varDecls.join(", ")}) {
  pyloEventFieldValues(${argParts.join(", ")}) {
    value
    count
  }
}`;

  return { query, variables };
}

// The `me` endpoint. `me` is a virtual entity: its shape lives in the generated
// schema like any other entity, so the selection is built with the same
// machinery as `byId`. It differs in two ways — there is no `id` argument (the
// server resolves the subject from the credentials), and the payload is not
// wrapped in a `data` envelope.
export function buildMeQuery(options: ByIdOptionsInput | undefined): BuildResult {
  const select = requireSelect("me", "me", options?.select);

  const variables: Record<string, unknown> = {};
  const variableTypes = new Map<string, string>();

  const selectionSet = buildSelectionSet(select, variables, variableTypes, "r_");

  const varDecls = Array.from(variableTypes.entries())
    .map(([name, type]) => `$${name}: ${type}`)
    .join(", ");
  const varSection = varDecls ? `(${varDecls})` : "";

  const query = `query Me${varSection} {
  me {
    ${selectionSet}
  }
}`;

  return { query, variables };
}

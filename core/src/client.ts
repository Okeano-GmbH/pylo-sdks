import {
  graphqlRequest,
  DEFAULT_GRAPHQL_ENDPOINT,
  hasErrors,
  extractErrorMessage,
  mergeHeaders,
} from "@pylo/auth";
import {
  buildListQuery,
  buildByIdQuery,
  buildEntityAggregateQuery,
  buildEventAggregateQuery,
  buildEventListQuery,
  buildEventPropertyKeysQuery,
  buildEventFieldValuesQuery,
  buildMeQuery,
  capitalize,
} from "./query-builder.js";
import {
  buildUpsertMutation,
  buildBulkUpsertMutation,
  buildDeleteMutation,
  buildIngestEventsMutation,
} from "./mutation-builder.js";
import {
  CREATE_UPLOAD_MUTATION,
  CREATE_DOWNLOAD_MUTATION,
  buildCreateUploadInput,
  buildAttachMutation,
  toUploadPart,
  uploadToUrl,
} from "./upload.js";
import type {
  UploadUrl,
  UploadSource,
  UploadOptions,
  CreateUploadUrlOptions,
  CreateUploadInput,
  PyloUploadedFile,
} from "./upload.js";
import type {
  AggregateResult,
  EventAggregateOptions,
  EventGroupByInput,
  EventMetricInput,
  MetricValue,
  PaginationData,
  PyloEvent,
  PyloEventInput,
  EventListOptions,
  PyloEventListResult,
  PyloEventProperty,
  PyloEventFieldValue,
  PyloEventPropertyKeysOptions,
  PyloEventFieldValuesOptions,
  QueryInput,
} from "./shared-types.js";
import type {
  AggregateGroupByInput,
  AggregateMetricInput,
  AggregateOptions,
  EntityName,
  EntityResult,
  ListOptions,
  ByIdOptions,
  ListResult,
  SelectConstraint,
  CallableEntityName,
  UpsertInput,
  RequestOptions,
  MutationRequestOptions,
} from "./types.js";

export const PYLO_DRY_RUN_HEADER = "pylo-dry-run";
export const PYLO_DO_NOT_TRIGGER_FLOWS_HEADER = "pylo-do-not-trigger-flow";

export function flagsToHeaders(flags: {
  dryRun?: boolean;
  doNotTriggerFlows?: boolean;
}): Record<string, string> | undefined {
  if (!flags.dryRun && !flags.doNotTriggerFlows) return undefined;
  const headers: Record<string, string> = {};
  if (flags.dryRun) headers[PYLO_DRY_RUN_HEADER] = "1";
  if (flags.doNotTriggerFlows) headers[PYLO_DO_NOT_TRIGGER_FLOWS_HEADER] = "1";
  return headers;
}

export class PyloError extends Error {
  graphqlErrors: unknown;

  constructor(message: string, graphqlErrors?: unknown) {
    super(message);
    this.name = "PyloError";
    this.graphqlErrors = graphqlErrors;
  }
}

export type AuthProvider = () => Promise<{ token?: string; apiKey?: string }>;

export interface ClientOptions {
  endpoint?: string;
  auth: AuthProvider;
  headers?: Record<string, string>;
}

// Aggregation over an entity. Kept separate from the rest of `EntityClient` so
// the two aggregate surfaces — entities and the event store — stay comparable.
export interface EntityAggregateApi<S, E extends EntityName<S>> {
  // Metrics are keyed by alias (`{ revenue: { sum: "amount" } }`) and read back
  // by the same keys: `total.revenue`. `groupBy` adds breakdown rows; without it
  // the backend returns none, and `rows` types as the empty tuple.
  aggregate<
    const M extends Record<string, AggregateMetricInput<S, E>>,
    const G extends readonly AggregateGroupByInput<S, E>[] = [],
  >(
    options: AggregateOptions<S, E, M, G> & RequestOptions,
  ): Promise<AggregateResult<M, G>>;

  // How many rows match — the common case of the above, without the ceremony.
  count(options?: { query?: QueryInput[] } & RequestOptions): Promise<number>;
}

export interface EntityClient<S, E extends EntityName<S>> extends EntityAggregateApi<S, E> {
  list<Sel extends SelectConstraint<S, E, Sel>>(
    options: ListOptions<S, E, Sel> & RequestOptions,
  ): Promise<ListResult<EntityResult<S, E, Sel>>>;

  byId<Sel extends SelectConstraint<S, E, Sel>>(
    id: string,
    options: ByIdOptions<S, E, Sel> & RequestOptions,
  ): Promise<EntityResult<S, E, Sel> | null>;

  upsert(input: UpsertInput<S, E>, options?: MutationRequestOptions): Promise<{ id: string }>;

  // Upserts many rows in a single all-or-nothing transaction. Each element is
  // upserted individually — rows without an `id`/`__search_value` are created —
  // and the ids of the affected rows are returned in input order.
  bulkUpsert(
    inputs: UpsertInput<S, E>[],
    options?: MutationRequestOptions,
  ): Promise<{ id: string }[]>;

  delete(ids: string[], options?: MutationRequestOptions): Promise<{ success: boolean }>;
}

// Ingests custom events. Event names are namespaced under "custom." by the
// backend (the prefix is added if missing) and `ts` is server-generated.
// "ingestEvents" is a reserved key on the client — it shadows any entity of
// the same name.
export type IngestEvents = (
  events: PyloEventInput[],
  options?: MutationRequestOptions,
) => Promise<PyloEvent[]>;

// Reads custom events from the event store. Exposed as `client.events`, a
// reserved key that shadows any entity of the same name (events are namespaced
// under "custom." server-side, so a real entity collision is unlikely).
export interface EventsClient {
  // List raw events, or — when `filter.dimensions` / `interval` / `group_by`
  // are set — grouped/analytics rows plus grand-total `aggregations`.
  list(options?: EventListOptions & RequestOptions): Promise<PyloEventListResult>;

  // Aggregate the event store. Identical in shape to `<entity>.aggregate`, and
  // returns the same `{ rows, total }` — the underlying endpoint's `data` /
  // `aggregations` envelope is normalized away. Fields are top-level columns or
  // dotted property paths; there is no schema to check them against.
  aggregate<
    const M extends Record<string, EventMetricInput>,
    const G extends readonly EventGroupByInput[] = [],
  >(
    options: EventAggregateOptions<M, G> & RequestOptions,
  ): Promise<AggregateResult<M, G>>;

  // How many events match.
  count(
    options?: {
      filter?: { query?: QueryInput[] };
      startTime?: string;
    } & RequestOptions,
  ): Promise<number>;

  // Infer the property paths (and JSON types) present across recent events.
  propertyKeys(
    options?: PyloEventPropertyKeysOptions & RequestOptions,
  ): Promise<PyloEventProperty[]>;

  // The most frequent distinct values of a single field, with their counts.
  fieldValues(
    field: string,
    options?: PyloEventFieldValuesOptions & RequestOptions,
  ): Promise<PyloEventFieldValue[]>;
}

// Reads the authenticated principal. `me` is a virtual entity — its shape comes
// from the generated schema like any other entity, so `select` and the result
// type work exactly as they do on `byId`, but it is reached through this
// dedicated endpoint because there is no `meById`. Takes no id: the server
// resolves the subject from the request's credentials.
export type Me<S> = "me" extends EntityName<S>
  ? <Sel extends SelectConstraint<S, "me" & EntityName<S>, Sel>>(
      options: ByIdOptions<S, "me" & EntityName<S>, Sel> & RequestOptions,
    ) => Promise<EntityResult<S, "me" & EntityName<S>, Sel>>
  : never;

// Keys the client reserves for itself. They shadow any entity of the same name.
type ReservedClientKey = "ingestEvents" | "events" | "me" | "files";

// File upload/download. Pylo uploads are a two-step uploadUrl flow: `createUpload`
// returns `{ id, url }` (id = the future pyloMedia id, url = an expiring Pylo
// fileservice endpoint), then the bytes are POSTed to that url — see
// `./upload.ts`. Exposed as `client.files`, a reserved key that shadows any
// entity of the same name.
export interface FilesClient<S> {
  // Uploads a file and returns the new pyloMedia row's id. Pass
  // `entityRelationPath` to enforce the relation's mime/extension allowlists,
  // and `attachTo` to connect the file to a record in the same call.
  upload(
    source: UploadSource,
    options?: UploadOptions<S> & RequestOptions,
  ): Promise<PyloUploadedFile>;

  // Lower-level escape hatch: requests the upload URL without sending bytes
  // (e.g. to hand it to another process). It expires (~1h).
  createUploadUrl(
    options?: CreateUploadUrlOptions<S> & RequestOptions,
  ): Promise<UploadUrl>;

  // Creates a fresh download URL for a pyloMedia id. Private-file URLs expire
  // quickly (default ~5 minutes) — don't cache them.
  getDownloadUrl(id: string, options?: RequestOptions): Promise<string>;
}

export type PyloClient<S> = {
  // Virtual entities are absent: they have no endpoints to call, and the two
  // that exist are reached through their own handling — `client.me()` and
  // `client.events`.
  [E in Exclude<CallableEntityName<S>, ReservedClientKey>]: EntityClient<S, E>;
} & {
  ingestEvents: IngestEvents;
  events: EventsClient;
  me: Me<S>;
  files: FilesClient<S>;
};

function getEndpoint(endpoint?: string): string {
  if (endpoint) return endpoint;
  return process.env["PYLO_GRAPHQL_ENDPOINT"] ?? DEFAULT_GRAPHQL_ENDPOINT;
}

async function executeGraphQL<T>(
  endpoint: string,
  query: string,
  variables: Record<string, unknown>,
  auth: AuthProvider,
  headers?: Record<string, string>,
): Promise<T> {
  const credentials = await auth();

  const response = await graphqlRequest<T>(endpoint, query, variables, {
    ...credentials,
    ...(headers !== undefined ? { headers } : {}),
  });

  if (hasErrors(response)) {
    const message = extractErrorMessage(response.errors) ?? "GraphQL request failed";
    throw new PyloError(message, response.errors);
  }

  if (!response.data) {
    throw new PyloError("No data returned from GraphQL request");
  }

  return response.data;
}

// The API is inconsistent about how it types metric values on the wire: `count`
// arrives as a JSON number, but `sum`/`avg`/`min`/`max` over a *custom* entity
// arrive as strings, because Postgres returns `numeric` as a string through PDO
// (e.g. "10.815217391304348"). System entities, whose fields are native columns,
// return numbers throughout. Callers shouldn't have to know which case they are
// in, so metric values are coerced here.
function coerceMetricValue(value: unknown): MetricValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isNaN(value) ? null : value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

// Coerce only the keys we know are metrics — the aliases just sent — so
// breakdown values pass through exactly as received. That matters: a group key
// can legitimately be a numeric-looking string and must not be rewritten.
//
// Every requested alias is materialized, including ones the payload omits (the
// endpoint returns a null `aggregations` when it computed nothing). The result
// type promises a key per metric, so leaving one out would make that a lie.
function coerceMetrics(
  row: Record<string, unknown>,
  aliases: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...row };
  for (const alias of aliases) {
    result[alias] = coerceMetricValue(result[alias]);
  }
  return result;
}

function metricAliases(options: { metrics?: unknown }): string[] {
  const metrics = options.metrics;
  if (!metrics || typeof metrics !== "object") return [];
  return Object.keys(metrics as Record<string, unknown>);
}

/**
 * Normalize an aggregate payload into the `{ rows, total }` both surfaces
 * return, coercing metric values to numbers. Exported because the React hooks
 * talk to the API route directly rather than through the client, and must not
 * re-implement the coercion.
 *
 * Entity payloads supply `rows` / `total`; event payloads supply `data` /
 * `aggregations` (pass them in that order).
 */
export function toAggregateResult(
  rows: unknown,
  total: unknown,
  options: { metrics?: unknown },
): { rows: unknown[]; total: Record<string, unknown> } {
  const aliases = metricAliases(options);
  return {
    rows: Array.isArray(rows)
      ? rows.map((row) => coerceMetrics((row ?? {}) as Record<string, unknown>, aliases))
      : [],
    total: coerceMetrics((total ?? {}) as Record<string, unknown>, aliases),
  };
}

async function runEntityAggregate(
  entityKey: string,
  endpoint: string,
  auth: AuthProvider,
  options: { metrics?: unknown } & RequestOptions,
  globalHeaders?: Record<string, string>,
): Promise<{ rows: unknown[]; total: Record<string, unknown> }> {
  const { query, variables } = buildEntityAggregateQuery(
    capitalize(entityKey),
    options as Record<string, unknown>,
  );

  const data = await executeGraphQL<
    Record<string, { rows: unknown; total: unknown } | null>
  >(endpoint, query, variables, auth, mergeHeaders(globalHeaders, options?.headers));

  const result = data["entityInstanceAggregate"];
  if (!result) {
    throw new PyloError("Unexpected response shape — missing entityInstanceAggregate");
  }

  return toAggregateResult(result.rows, result.total, options);
}

async function runEventAggregate(
  endpoint: string,
  auth: AuthProvider,
  options: { metrics?: unknown } & RequestOptions,
  globalHeaders?: Record<string, string>,
): Promise<{ rows: unknown[]; total: Record<string, unknown> }> {
  const { query, variables } = buildEventAggregateQuery(options as Record<string, unknown>);

  const data = await executeGraphQL<
    Record<string, { data: unknown; aggregations: unknown } | null>
  >(endpoint, query, variables, auth, mergeHeaders(globalHeaders, options?.headers));

  const result = data["pyloEventList"];
  if (!result) {
    throw new PyloError("Unexpected response shape — missing pyloEventList");
  }

  // `pyloEventList` names the grouped rows `data` and the grand total
  // `aggregations`; rename both so the two aggregate surfaces are identical to
  // callers. `aggregations` is null when the query ran without metrics.
  return toAggregateResult(result.data, result.aggregations, options);
}

function createEntityClient<S, E extends EntityName<S>>(
  entityKey: string,
  endpoint: string,
  auth: AuthProvider,
  globalHeaders?: Record<string, string>,
): EntityClient<S, E> {
  return {
    async list(options) {
      const { query, variables } = buildListQuery(
        entityKey,
        options as unknown as Record<string, unknown>,
      );

      const data = await executeGraphQL<Record<string, { data: unknown[]; pagination: PaginationData }>>(
        endpoint,
        query,
        variables,
        auth,
        mergeHeaders(globalHeaders, options?.headers),
      );

      const listKey = `${entityKey}List`;
      const result = data[listKey];
      if (!result) {
        throw new PyloError(`Unexpected response shape — missing ${listKey}`);
      }

      // Runtime returns raw data; type safety is at the generic layer
      return { data: result.data, pagination: result.pagination } as never;
    },

    async byId(id, options) {
      const { query, variables } = buildByIdQuery(
        entityKey,
        id,
        options as unknown as Record<string, unknown>,
      );

      const data = await executeGraphQL<Record<string, { data: unknown } | null>>(
        endpoint,
        query,
        variables,
        auth,
        mergeHeaders(globalHeaders, options?.headers),
      );

      const byIdKey = `${entityKey}ById`;
      const result = data[byIdKey];
      if (!result) return null as never;

      return result.data as never;
    },

    async aggregate(options) {
      const result = await runEntityAggregate(
        entityKey,
        endpoint,
        auth,
        options as { metrics?: unknown } & RequestOptions,
        globalHeaders,
      );

      return result as never;
    },

    async count(options) {
      const { total } = await runEntityAggregate(
        entityKey,
        endpoint,
        auth,
        {
          metrics: { count: "count" },
          ...(options?.query !== undefined ? { filter: { query: options.query } } : {}),
          ...(options?.headers !== undefined ? { headers: options.headers } : {}),
        },
        globalHeaders,
      );

      return (total["count"] as number | null) ?? 0;
    },

    async upsert(input, options) {
      const pascalName = capitalize(entityKey);

      const { query, variables } = buildUpsertMutation(
        entityKey,
        pascalName,
        input as Record<string, unknown>,
      );

      const data = await executeGraphQL<Record<string, { data: { id: string } }>>(
        endpoint,
        query,
        variables,
        auth,
        mergeHeaders(
          mergeHeaders(globalHeaders, options?.headers),
          flagsToHeaders(options ?? {}),
        ),
      );

      const mutationKey = `update${pascalName}`;
      const result = data[mutationKey];
      if (!result) {
        throw new PyloError(`Unexpected response shape — missing ${mutationKey}`);
      }

      return result.data;
    },

    async bulkUpsert(inputs, options) {
      const pascalName = capitalize(entityKey);

      const { query, variables } = buildBulkUpsertMutation(
        entityKey,
        pascalName,
        inputs as Record<string, unknown>[],
      );

      const data = await executeGraphQL<Record<string, { data: { id: string }[] }>>(
        endpoint,
        query,
        variables,
        auth,
        mergeHeaders(
          mergeHeaders(globalHeaders, options?.headers),
          flagsToHeaders(options ?? {}),
        ),
      );

      const mutationKey = `bulkUpdate${pascalName}`;
      const result = data[mutationKey];
      if (!result) {
        throw new PyloError(`Unexpected response shape — missing ${mutationKey}`);
      }

      return result.data;
    },

    async delete(ids, options) {
      const pascalName = capitalize(entityKey);

      const { query, variables } = buildDeleteMutation(
        entityKey,
        pascalName,
        ids,
      );

      const data = await executeGraphQL<Record<string, { data: { success: boolean } }>>(
        endpoint,
        query,
        variables,
        auth,
        mergeHeaders(
          mergeHeaders(globalHeaders, options?.headers),
          flagsToHeaders(options ?? {}),
        ),
      );

      const mutationKey = `delete${pascalName}`;
      const result = data[mutationKey];
      if (!result) {
        throw new PyloError(`Unexpected response shape — missing ${mutationKey}`);
      }

      return result.data;
    },
  };
}

function createIngestEvents(
  endpoint: string,
  auth: AuthProvider,
  globalHeaders?: Record<string, string>,
): IngestEvents {
  return async (events, options) => {
    const { query, variables } = buildIngestEventsMutation(events);

    const data = await executeGraphQL<Record<string, { data: PyloEvent[] }>>(
      endpoint,
      query,
      variables,
      auth,
      mergeHeaders(
        mergeHeaders(globalHeaders, options?.headers),
        flagsToHeaders(options ?? {}),
      ),
    );

    const result = data["ingestPyloEventData"];
    if (!result) {
      throw new PyloError("Unexpected response shape — missing ingestPyloEventData");
    }

    return result.data;
  };
}

function createEventsClient(
  endpoint: string,
  auth: AuthProvider,
  globalHeaders?: Record<string, string>,
): EventsClient {
  return {
    async list(options) {
      const { query, variables } = buildEventListQuery(options);

      const data = await executeGraphQL<Record<string, PyloEventListResult>>(
        endpoint,
        query,
        variables,
        auth,
        mergeHeaders(globalHeaders, options?.headers),
      );

      const result = data["pyloEventList"];
      if (!result) {
        throw new PyloError("Unexpected response shape — missing pyloEventList");
      }

      return result;
    },

    async aggregate(options) {
      const result = await runEventAggregate(
        endpoint,
        auth,
        options as { metrics?: unknown } & RequestOptions,
        globalHeaders,
      );

      return result as never;
    },

    async count(options) {
      const { total } = await runEventAggregate(
        endpoint,
        auth,
        {
          metrics: { count: "count" },
          ...(options?.filter !== undefined ? { filter: options.filter } : {}),
          ...(options?.startTime !== undefined ? { startTime: options.startTime } : {}),
          ...(options?.headers !== undefined ? { headers: options.headers } : {}),
        },
        globalHeaders,
      );

      return (total["count"] as number | null) ?? 0;
    },

    async propertyKeys(options) {
      const { query, variables } = buildEventPropertyKeysQuery(options);

      const data = await executeGraphQL<Record<string, PyloEventProperty[]>>(
        endpoint,
        query,
        variables,
        auth,
        mergeHeaders(globalHeaders, options?.headers),
      );

      return data["pyloEventPropertyKeys"] ?? [];
    },

    async fieldValues(field, options) {
      const { query, variables } = buildEventFieldValuesQuery(field, options);

      const data = await executeGraphQL<Record<string, PyloEventFieldValue[]>>(
        endpoint,
        query,
        variables,
        auth,
        mergeHeaders(globalHeaders, options?.headers),
      );

      return data["pyloEventFieldValues"] ?? [];
    },
  };
}

function createMe<S>(
  endpoint: string,
  auth: AuthProvider,
  globalHeaders?: Record<string, string>,
): Me<S> {
  const me = async (options: { select: unknown } & RequestOptions) => {
    const { query, variables } = buildMeQuery(
      options as unknown as Record<string, unknown>,
    );

    const data = await executeGraphQL<Record<string, unknown>>(
      endpoint,
      query,
      variables,
      auth,
      mergeHeaders(globalHeaders, options?.headers),
    );

    // Unlike `<entity>ById`, `me` is not wrapped in a `data` envelope.
    const result = data["me"];
    if (result === undefined || result === null) {
      throw new PyloError("Unexpected response shape — missing me");
    }

    return result;
  };

  return me as Me<S>;
}

function createFilesClient<S>(
  endpoint: string,
  auth: AuthProvider,
  globalHeaders?: Record<string, string>,
): FilesClient<S> {
  async function requestUploadUrl(
    input: CreateUploadInput | null,
    options?: RequestOptions,
  ): Promise<UploadUrl> {
    const data = await executeGraphQL<{ createUpload: UploadUrl }>(
      endpoint,
      CREATE_UPLOAD_MUTATION,
      { input },
      auth,
      mergeHeaders(globalHeaders, options?.headers),
    );

    const result = data.createUpload;
    if (!result) {
      throw new PyloError("Unexpected response shape — missing createUpload");
    }
    return result;
  }

  return {
    // `async` so a bad option combination surfaces as a rejection rather than
    // a synchronous throw from a Promise-returning method.
    async createUploadUrl(options?: CreateUploadUrlOptions<S> & RequestOptions) {
      return requestUploadUrl(buildCreateUploadInput(options), options);
    },

    async upload(source, options) {
      // Validate before touching the bytes so bad option combinations fail
      // without creating a pyloMedia row.
      const input = buildCreateUploadInput(options);
      const part = toUploadPart(source, options);
      const uploadUrl = await requestUploadUrl(input, options);

      await uploadToUrl(uploadUrl.url, part.blob, part.fileName, options ?? {});

      if (options?.attachTo) {
        const { query, variables } = buildAttachMutation(
          options.entityRelationPath as string,
          uploadUrl.id,
          options.attachTo,
        );
        await executeGraphQL(
          endpoint,
          query,
          variables,
          auth,
          mergeHeaders(globalHeaders, options.headers),
        );
      }

      return {
        id: uploadUrl.id,
        fileName: part.fileName,
        mimeType: part.mimeType,
        size: part.blob.size,
      };
    },

    async getDownloadUrl(id, options) {
      const data = await executeGraphQL<{ createDownload: { id: string; url: string } }>(
        endpoint,
        CREATE_DOWNLOAD_MUTATION,
        { id },
        auth,
        mergeHeaders(globalHeaders, options?.headers),
      );

      const result = data.createDownload;
      if (!result) {
        throw new PyloError("Unexpected response shape — missing createDownload");
      }
      return result.url;
    },
  };
}

export function createPyloClient<S>(options: ClientOptions): PyloClient<S> {
  const endpoint = getEndpoint(options.endpoint);
  const auth = options.auth;
  const globalHeaders = options.headers;

  const ingestEvents = createIngestEvents(endpoint, auth, globalHeaders);
  const events = createEventsClient(endpoint, auth, globalHeaders);
  const me = createMe<S>(endpoint, auth, globalHeaders);
  const files = createFilesClient<S>(endpoint, auth, globalHeaders);

  return new Proxy({} as PyloClient<S>, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop === "ingestEvents") return ingestEvents;
      if (prop === "events") return events;
      if (prop === "me") return me;
      if (prop === "files") return files;
      return createEntityClient<S, EntityName<S>>(prop, endpoint, auth, globalHeaders);
    },
  });
}

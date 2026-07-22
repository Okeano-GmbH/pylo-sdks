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
import type {
  PaginationData,
  PyloEvent,
  PyloEventInput,
  EventListOptions,
  PyloEventListResult,
  PyloEventProperty,
  PyloEventFieldValue,
  PyloEventPropertyKeysOptions,
  PyloEventFieldValuesOptions,
} from "./shared-types.js";
import type {
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

export interface EntityClient<S, E extends EntityName<S>> {
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

export type PyloClient<S> = {
  [E in CallableEntityName<S>]: EntityClient<S, E>;
} & {
  ingestEvents: IngestEvents;
  events: EventsClient;
  me: Me<S>;
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

export function createPyloClient<S>(options: ClientOptions): PyloClient<S> {
  const endpoint = getEndpoint(options.endpoint);
  const auth = options.auth;
  const globalHeaders = options.headers;

  const ingestEvents = createIngestEvents(endpoint, auth, globalHeaders);
  const events = createEventsClient(endpoint, auth, globalHeaders);
  const me = createMe<S>(endpoint, auth, globalHeaders);

  return new Proxy({} as PyloClient<S>, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop === "ingestEvents") return ingestEvents;
      if (prop === "events") return events;
      if (prop === "me") return me;
      return createEntityClient<S, EntityName<S>>(prop, endpoint, auth, globalHeaders);
    },
  });
}

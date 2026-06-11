import {
  graphqlRequest,
  DEFAULT_GRAPHQL_ENDPOINT,
  hasErrors,
  extractErrorMessage,
  mergeHeaders,
} from "@pylo/auth";
import { buildListQuery, buildByIdQuery } from "./query-builder.js";
import {
  buildUpsertMutation,
  buildDeleteMutation,
  buildIngestEventsMutation,
} from "./mutation-builder.js";
import { serializeJsonFields, parseJsonFields } from "./json-fields.js";
import type {
  SchemaMetadata,
  PaginationData,
  PyloEvent,
  PyloEventInput,
} from "./shared-types.js";
import type {
  EntityName,
  EntitySelect,
  EntityResult,
  ListOptions,
  ByIdOptions,
  ListResult,
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
  schemaMetadata: SchemaMetadata;
  auth: AuthProvider;
  headers?: Record<string, string>;
}

export interface EntityClient<S, E extends EntityName<S>> {
  list<Sel extends EntitySelect<S, E> | undefined = undefined>(
    options?: ListOptions<S, E, Sel> & RequestOptions,
  ): Promise<ListResult<EntityResult<S, E, Sel>>>;

  byId<Sel extends EntitySelect<S, E> | undefined = undefined>(
    id: string,
    options?: ByIdOptions<S, E, Sel> & RequestOptions,
  ): Promise<EntityResult<S, E, Sel> | null>;

  upsert(input: UpsertInput<S, E>, options?: MutationRequestOptions): Promise<{ id: string }>;

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

export type PyloClient<S> = {
  [E in EntityName<S>]: EntityClient<S, E>;
} & {
  ingestEvents: IngestEvents;
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
  metadata: SchemaMetadata,
  auth: AuthProvider,
  globalHeaders?: Record<string, string>,
): EntityClient<S, E> {
  return {
    async list(options) {
      const { query, variables } = buildListQuery(
        entityKey,
        options as Record<string, unknown>,
        metadata,
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
        options as Record<string, unknown>,
        metadata,
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
      const entityMeta = metadata.entities[entityKey];
      if (!entityMeta) {
        throw new PyloError(`Unknown entity: ${entityKey}`);
      }

      const { query, variables } = buildUpsertMutation(
        entityKey,
        entityMeta.pascalName,
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

      const mutationKey = `update${entityMeta.pascalName}`;
      const result = data[mutationKey];
      if (!result) {
        throw new PyloError(`Unexpected response shape — missing ${mutationKey}`);
      }

      return result.data;
    },

    async delete(ids, options) {
      const entityMeta = metadata.entities[entityKey];
      if (!entityMeta) {
        throw new PyloError(`Unknown entity: ${entityKey}`);
      }

      const { query, variables } = buildDeleteMutation(
        entityKey,
        entityMeta.pascalName,
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

      const mutationKey = `delete${entityMeta.pascalName}`;
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

export function createPyloClient<S>(options: ClientOptions): PyloClient<S> {
  const endpoint = getEndpoint(options.endpoint);
  const metadata = options.schemaMetadata;
  const auth = options.auth;
  const globalHeaders = options.headers;

  const ingestEvents = createIngestEvents(endpoint, auth, globalHeaders);

  return new Proxy({} as PyloClient<S>, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop === "ingestEvents") return ingestEvents;
      return createEntityClient<S, EntityName<S>>(prop, endpoint, metadata, auth, globalHeaders);
    },
  });
}

import {
  graphqlRequest,
  DEFAULT_GRAPHQL_ENDPOINT,
  hasErrors,
  extractErrorMessage,
} from "@pylo/auth";
import { buildListQuery, buildByIdQuery } from "./query-builder.js";
import { buildUpsertMutation, buildDeleteMutation } from "./mutation-builder.js";
import type { SchemaMetadata, PaginationData } from "./shared-types.js";
import type {
  EntityName,
  EntitySelect,
  EntityResult,
  ListOptions,
  ByIdOptions,
  ListResult,
  UpsertInput,
} from "./types.js";

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
}

export interface EntityClient<S, E extends EntityName<S>> {
  list<Sel extends EntitySelect<S, E> | undefined = undefined>(
    options?: ListOptions<S, E, Sel>,
  ): Promise<ListResult<EntityResult<S, E, Sel>>>;

  byId<Sel extends EntitySelect<S, E> | undefined = undefined>(
    id: string,
    options?: ByIdOptions<S, E, Sel>,
  ): Promise<EntityResult<S, E, Sel> | null>;

  upsert(input: UpsertInput<S, E>): Promise<{ id: string }>;

  delete(ids: string[]): Promise<{ success: boolean }>;
}

export type PyloClient<S> = {
  [E in EntityName<S>]: EntityClient<S, E>;
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
): Promise<T> {
  const credentials = await auth();

  const response = await graphqlRequest<T>(endpoint, query, variables, credentials);

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
      );

      const result = data[entityKey];
      if (!result) return null as never;

      return result.data as never;
    },

    async upsert(input) {
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
      );

      const mutationKey = `update${entityMeta.pascalName}`;
      const result = data[mutationKey];
      if (!result) {
        throw new PyloError(`Unexpected response shape — missing ${mutationKey}`);
      }

      return result.data;
    },

    async delete(ids) {
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

export function createPyloClient<S>(options: ClientOptions): PyloClient<S> {
  const endpoint = getEndpoint(options.endpoint);
  const metadata = options.schemaMetadata;
  const auth = options.auth;

  return new Proxy({} as PyloClient<S>, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      return createEntityClient<S, EntityName<S>>(prop, endpoint, metadata, auth);
    },
  });
}

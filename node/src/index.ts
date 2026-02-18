import { createPyloClient } from "@pylo/core";
import type { PyloClient, SchemaMetadata } from "@pylo/core";

interface NodeClientOptions {
  apiKey: string;
  endpoint?: string;
  schemaMetadata: SchemaMetadata;
}

export function createPyloNode<S>(options: NodeClientOptions): PyloClient<S> {
  return createPyloClient<S>({
    ...(options.endpoint !== undefined ? { endpoint: options.endpoint } : {}),
    schemaMetadata: options.schemaMetadata,
    auth: async () => ({ apiKey: options.apiKey }),
  });
}

// Re-export all types from @pylo/core
export type {
  QueryOperator,
  SortOrder,
  QueryInputCondition,
  QueryInput,
  SortInput,
  FilterInput,
  PaginationInput,
  PaginationData,
  SearchValueInput,
  EntityMetadata,
  SchemaMetadata,
  EntityName,
  EntityFields,
  EntityRelations,
  EntitySelect,
  EntityResult,
  UpsertInput,
  StrictSelect,
  ListOptions,
  ByIdOptions,
  ListResult,
  AuthProvider,
  ClientOptions,
  EntityClient,
  PyloClient,
} from "@pylo/core";

export { PyloError } from "@pylo/core";

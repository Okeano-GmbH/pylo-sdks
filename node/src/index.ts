import { createPyloClient } from "@pylo/core";
import type { PyloClient, SchemaMetadata } from "@pylo/core";

interface NodeClientOptions {
  apiKey: string;
  endpoint?: string;
  schemaMetadata: SchemaMetadata;
  headers?: Record<string, string>;
}

export function createPyloNode<S>(options: NodeClientOptions): PyloClient<S> {
  return createPyloClient<S>({
    ...(options.endpoint !== undefined ? { endpoint: options.endpoint } : {}),
    schemaMetadata: options.schemaMetadata,
    auth: async () => ({ apiKey: options.apiKey }),
    ...(options.headers !== undefined ? { headers: options.headers } : {}),
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
  PyloEvent,
  PyloEventInput,
  AggregateFunction,
  AggregateInput,
  TimeBucketInput,
  DimensionInput,
  EventListFilterInput,
  EventListOptions,
  PyloEventListResult,
  PyloEventProperty,
  PyloEventFieldValue,
  PyloEventPropertyKeysOptions,
  PyloEventFieldValuesOptions,
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
  RequestOptions,
  MutationRequestOptions,
  AuthProvider,
  ClientOptions,
  EntityClient,
  IngestEvents,
  EventsClient,
  PyloClient,
} from "@pylo/core";

export { PyloError } from "@pylo/core";

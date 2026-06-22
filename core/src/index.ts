// Shared types
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
} from "./shared-types.js";

// SDK type system
export type {
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
} from "./types.js";

// Query & mutation builders
export {
  buildListQuery,
  buildByIdQuery,
  buildEventListQuery,
  buildEventPropertyKeysQuery,
  buildEventFieldValuesQuery,
  capitalize,
} from "./query-builder.js";
export {
  buildUpsertMutation,
  buildDeleteMutation,
  buildIngestEventsMutation,
} from "./mutation-builder.js";

// Header utilities
export { mergeHeaders } from "@pylo/auth";

// Client
export {
  PyloError,
  createPyloClient,
  flagsToHeaders,
  PYLO_DRY_RUN_HEADER,
  PYLO_DO_NOT_TRIGGER_FLOWS_HEADER,
} from "./client.js";

export type {
  AuthProvider,
  ClientOptions,
  EntityClient,
  IngestEvents,
  EventsClient,
  PyloClient,
} from "./client.js";

// Codegen types only (import defineConfig from "@pylo/core/codegen")
export type { PyloConfig } from "./codegen/index.js";

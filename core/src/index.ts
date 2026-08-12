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
  MetricValue,
  DimensionValue,
  AggregateInterval,
  AggregateIntervalUnit,
  RowKeyOf,
  AggregateSortKey,
  AggregateSortInput,
  AggregateFilterInput,
  AggregateTotal,
  AggregateRow,
  AggregateRows,
  AggregateResult,
  EventMetricInput,
  EventGroupByInput,
  EventAggregateOptions,
} from "./shared-types.js";

// SDK type system
export type {
  EntityName,
  CallableEntityName,
  VirtualEntityName,
  SystemEntityName,
  EntityFields,
  EntityRelations,
  EntitySelect,
  EntityResult,
  UpsertInput,
  NoExcess,
  SelectConstraint,
  ListOptions,
  ByIdOptions,
  ListResult,
  RequestOptions,
  MutationRequestOptions,
  FieldName,
  NumericFieldName,
  AggregateMetricInput,
  AggregateGroupByInput,
  AggregateOptions,
} from "./types.js";

// Query & mutation builders
export {
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
export {
  buildUpsertMutation,
  buildBulkUpsertMutation,
  buildDeleteMutation,
  buildIngestEventsMutation,
} from "./mutation-builder.js";

// File upload
export {
  CREATE_UPLOAD_MUTATION,
  CREATE_DOWNLOAD_MUTATION,
  toUploadPart,
  uploadToUrl,
  splitEntityRelationPath,
  normalizeEntityRelationPath,
  buildCreateUploadInput,
  buildAttachMutation,
} from "./upload.js";
export type {
  UploadUrl,
  UploadProgress,
  UploadSource,
  UploadOptions,
  CreateUploadUrlOptions,
  CreateUploadInput,
  UploadAttachTarget,
  PyloUploadedFile,
  EntityRelationPath,
} from "./upload.js";

// Header utilities
export { mergeHeaders } from "@pylo/auth";

// Client
export {
  PyloError,
  createPyloClient,
  toAggregateResult,
  flagsToHeaders,
  PYLO_DRY_RUN_HEADER,
  PYLO_DO_NOT_TRIGGER_FLOWS_HEADER,
} from "./client.js";

export type {
  AuthProvider,
  ClientOptions,
  EntityClient,
  EntityAggregateApi,
  IngestEvents,
  EventsClient,
  Me,
  FilesClient,
  PyloClient,
} from "./client.js";

// Codegen types only (import defineConfig from "@pylo/core/codegen")
export type { PyloConfig } from "./codegen/index.js";

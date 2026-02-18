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
  EntityMetadata,
  SchemaMetadata,
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
} from "./types.js";

// Query & mutation builders
export { buildListQuery, buildByIdQuery } from "./query-builder.js";
export { buildUpsertMutation, buildDeleteMutation } from "./mutation-builder.js";

// Client
export {
  PyloError,
  createPyloClient,
} from "./client.js";

export type {
  AuthProvider,
  ClientOptions,
  EntityClient,
  PyloClient,
} from "./client.js";

// Codegen
export { defineConfig } from "./codegen/index.js";
export type { PyloConfig } from "./codegen/index.js";

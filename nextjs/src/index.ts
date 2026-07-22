// @pylo/nextjs — main entry point
// Re-exports shared types, SDK types, and PyloError from @pylo/core

import type {
  EntityName,
  EntitySelect,
  EntityResult,
} from "@pylo/core";

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
  EntityName,
  CallableEntityName,
  VirtualEntityName,
  EntityFields,
  EntityRelations,
  EntitySelect,
  EntityResult,
  UpsertInput,
  ListOptions,
  ByIdOptions,
  ListResult,
  RequestOptions,
  MutationRequestOptions,
  IngestEvents,
  Me,
} from "@pylo/core";

export { PyloError } from "@pylo/core";

/**
 * Augmentable registry that pins the schema type for the `PyloSelect` /
 * `PyloResult` helpers. Generated code augments it, e.g.:
 *
 *   declare module "@pylo/nextjs" {
 *     interface PyloRegister { schema: PyloSchema }
 *   }
 *
 * With no augmentation the helpers fall back to an untyped (`any`) schema.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface PyloRegister {}

export type RegisteredSchema = PyloRegister extends { schema: infer S }
  ? S
  : any;

/**
 * Entity keys available on the registered schema — e.g. `"contact"`. Use as the
 * type parameter for {@link PyloSelect} / {@link PyloResult}.
 */
export type PyloEntity = EntityName<RegisteredSchema>;

/**
 * A reusable, type-safe selection for one entity on the registered schema.
 * Lets you define what to fetch once and reuse it across hooks.
 *
 * Declare the selection with `satisfies` (not a plain `: PyloSelect<…>`
 * annotation) so the exact set of selected fields is preserved — that's what
 * keeps {@link PyloResult} precise:
 *
 * ```ts
 * const contactSelect = {
 *   name: true,
 *   email: true,
 *   company: { select: { name: true } },
 * } satisfies PyloSelect<"contact">;
 *
 * const { data } = usePyloList("contact", { select: contactSelect });
 * type Contact = PyloResult<"contact", typeof contactSelect>;
 * ```
 */
export type PyloSelect<E extends PyloEntity> = EntitySelect<RegisteredSchema, E>;

/**
 * The row type returned for a given entity and selection. Pair with
 * `typeof <yourSelect>` (see {@link PyloSelect}) for an exact result type.
 */
export type PyloResult<
  E extends PyloEntity,
  Sel extends PyloSelect<E>,
> = EntityResult<RegisteredSchema, E, Sel>;

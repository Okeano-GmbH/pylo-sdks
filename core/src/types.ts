// Core type system — conditional types that power the SDK's type safety.

import type {
  FilterInput,
  PaginationData,
  PaginationInput,
} from "./shared-types.js";

// Extract entity key strings from a PyloSchema
export type EntityName<S> = string & keyof S;

// Extract the scalar fields record for an entity
export type EntityFields<S, E extends EntityName<S>> = S[E] extends {
  fields: infer F;
}
  ? F
  : never;

// Extract the relations record for an entity
export type EntityRelations<S, E extends EntityName<S>> = S[E] extends {
  relations: infer R;
}
  ? R
  : never;

// Extract the updateInput type for an entity
export type UpsertInput<S, E extends EntityName<S>> = S[E] extends {
  updateInput: infer U;
}
  ? U
  : Record<string, unknown>;

// Helper: remove keys whose value is `never`
type OmitNever<T> = {
  [K in keyof T as T[K] extends never ? never : K]: T[K];
};

// Valid select shape for an entity. Relations must be selected explicitly —
// there is no `true` "expand all fields" shortcut.
// Scalar fields → `true`
// hasOne relations → `{ select, filter? }`
// hasMany relations → `{ select, filter?, pagination? }`
export type EntitySelect<
  S,
  E extends EntityName<S>,
  Depth extends number = 0,
> = Depth extends 5
  ? Record<string, never>
  : OmitNever<{
      [K in keyof EntityFields<S, E>]?: true;
    }> &
      {
        [K in keyof EntityRelations<S, E>]?: EntityRelations<
          S,
          E
        >[K] extends { type: "hasOne"; entity: infer Target }
          ? Target extends EntityName<S>
            ? {
                select: EntitySelect<S, Target, Increment[Depth]>;
                filter?: FilterInput;
              }
            : never
          : EntityRelations<S, E>[K] extends {
                type: "hasMany";
                entity: infer Target;
              }
            ? Target extends EntityName<S>
              ? {
                  select: EntitySelect<S, Target, Increment[Depth]>;
                  filter?: FilterInput;
                  pagination?: PaginationInput;
                }
              : never
            : never;
      };

// Depth increment helper (0→1, 1→2, ..., 4→5)
type Increment = [1, 2, 3, 4, 5, 5];

// Compute return type from a select object.
// - Scalar field with `true` → field's type from schema
// - hasOne relation → `{ data: TargetResult } | null`
// - hasMany relation → `{ data: TargetResult[] }`, plus `pagination` only when a
//   `pagination` key was supplied in the select
export type EntityResult<
  S,
  E extends EntityName<S>,
  Select extends EntitySelect<S, E>,
  Depth extends number = 0,
> = Depth extends 5
  ? Record<string, unknown>
  : Select extends EntitySelect<S, E>
    ? OmitNever<
        ScalarResult<S, E, Select> & RelationResult<S, E, Select, Depth>
      >
    : EntityFields<S, E>;

// Compute scalar fields from select
type ScalarResult<
  S,
  E extends EntityName<S>,
  Select extends EntitySelect<S, E>,
> = {
  [K in keyof Select &
    keyof EntityFields<S, E>]: Select[K] extends true
    ? EntityFields<S, E>[K]
    : never;
};

// Compute relation fields from select. Relations are always explicit objects
// `{ select, … }`; hasMany results carry `pagination` only when a `pagination`
// key was supplied (matching the opt-in runtime query builder).
type RelationResult<
  S,
  E extends EntityName<S>,
  Select extends EntitySelect<S, E>,
  Depth extends number = 0,
> = {
  [K in keyof Select &
    keyof EntityRelations<S, E>]: EntityRelations<S, E>[K] extends {
    type: "hasOne";
    entity: infer Target;
  }
    ? Target extends EntityName<S>
      ? Select[K] extends { select: infer SubSelect }
        ? SubSelect extends EntitySelect<S, Target>
          ? {
              data: EntityResult<
                S,
                Target,
                SubSelect,
                Increment[Depth]
              >;
            } | null
          : never
        : never
      : never
    : EntityRelations<S, E>[K] extends {
          type: "hasMany";
          entity: infer Target;
        }
      ? Target extends EntityName<S>
        ? Select[K] extends { select: infer SubSelect }
          ? SubSelect extends EntitySelect<S, Target>
            ? {
                data: Array<
                  EntityResult<
                    S,
                    Target,
                    SubSelect,
                    Increment[Depth]
                  >
                >;
              } & (Select[K] extends { pagination: unknown }
                ? { pagination: PaginationData }
                : unknown)
            : never
          : never
        : never
      : never;
};

// Rejects unknown keys by mapping them to `never`.
// Intersected with the base type so IDE still suggests valid keys.
export type StrictSelect<
  Sel,
  Valid,
> = Valid & {
  [K in keyof Sel]: K extends keyof Valid ? Sel[K] : never;
};

// Options for list queries. `select` is required — there is no implicit
// "all fields" default.
export type ListOptions<
  S,
  E extends EntityName<S>,
  Sel extends EntitySelect<S, E>,
> = {
  select: StrictSelect<Sel, EntitySelect<S, E>>;
  filter?: FilterInput;
  pagination?: PaginationInput;
};

// Options for byId queries. `select` is required.
export type ByIdOptions<
  S,
  E extends EntityName<S>,
  Sel extends EntitySelect<S, E>,
> = {
  select: StrictSelect<Sel, EntitySelect<S, E>>;
};

// List result with pagination
export interface ListResult<T> {
  data: T[];
  pagination: PaginationData;
}

// Transport-level options for individual operations
export interface RequestOptions {
  headers?: Record<string, string>;
}

// Mutation-only transport options. Mutations accept the same `headers` as
// reads, plus typed flags that map to Pylo-specific request headers:
// - `dryRun: true`     → `pylo-dry-run: 1`              (backend rolls back the transaction)
// - `doNotTriggerFlows: true` → `pylo-do-not-trigger-flow: 1` (suppresses downstream automation flows)
export interface MutationRequestOptions extends RequestOptions {
  dryRun?: boolean;
  doNotTriggerFlows?: boolean;
}

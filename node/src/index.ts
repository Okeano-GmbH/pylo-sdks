import { createPyloClient, PyloError } from "@pylo/core";
import type {
  AuthProvider,
  PyloClient,
  EntityName,
  EntitySelect,
  EntityResult,
} from "@pylo/core";

type TokenSource = string | (() => string | Promise<string>);

type NodeClientCredentials =
  | { apiKey: string; token?: never }
  | { token: TokenSource; apiKey?: never };

type NodeClientOptions = NodeClientCredentials & {
  endpoint?: string;
  headers?: Record<string, string>;
};

// A JS caller can bypass the union, so the credential is checked at runtime too.
function resolveAuth(options: NodeClientOptions): AuthProvider {
  const token: TokenSource | undefined = options.token;
  if (token !== undefined) {
    return async () => ({
      token: typeof token === "function" ? await token() : token,
    });
  }

  const apiKey: string | undefined = options.apiKey;
  if (apiKey !== undefined) {
    return async () => ({ apiKey });
  }

  throw new PyloError("createPyloNode requires either `apiKey` or `token`");
}

export function createPyloNode<S>(options: NodeClientOptions): PyloClient<S> {
  return createPyloClient<S>({
    ...(options.endpoint !== undefined ? { endpoint: options.endpoint } : {}),
    auth: resolveAuth(options),
    ...(options.headers !== undefined ? { headers: options.headers } : {}),
  });
}

/**
 * Augmentable registry that lets a host pin the schema type for the injected
 * `pylo` client. Generated code augments it, e.g.:
 *
 *   declare module "@pylo/node" {
 *     interface PyloRegister { schema: PyloSchema }
 *   }
 *
 * With no augmentation the client falls back to an untyped (`any`) schema.
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
 * Lets you define what to fetch once and reuse it across calls.
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
 * const { data } = await pylo.contact.list({ select: contactSelect });
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

/**
 * Zero-config client for environments that inject a ready-made client onto
 * `globalThis.__PYLO_FLOW_CLIENT__` — e.g. the Pylo flow worker, which builds
 * the client from the flow's API key and the customer's schema before running
 * an action. Property access is forwarded to the current global client at
 * access time, so a worker reused across customers always sees the live one.
 */
export const pylo: PyloClient<RegisteredSchema> = new Proxy(
  {} as PyloClient<RegisteredSchema>,
  {
    get(_target, prop) {
      const client = (globalThis as Record<string, unknown>)[
        "__PYLO_FLOW_CLIENT__"
      ] as Record<string | symbol, unknown> | undefined;
      if (!client) {
        throw new Error(
          "Pylo flow client unavailable (globalThis.__PYLO_FLOW_CLIENT__ is unset). `pylo` is only usable inside a Pylo flow action.",
        );
      }
      return client[prop];
    },
  },
);

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
  AuthProvider,
  ClientOptions,
  EntityClient,
  EntityAggregateApi,
  IngestEvents,
  EventsClient,
  Me,
  FilesClient,
  UploadUrl,
  UploadProgress,
  UploadSource,
  UploadOptions,
  CreateUploadUrlOptions,
  CreateUploadInput,
  UploadAttachTarget,
  PyloUploadedFile,
  EntityRelationPath,
  PyloClient,
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
  FieldName,
  NumericFieldName,
  AggregateMetricInput,
  AggregateGroupByInput,
  AggregateOptions,
} from "@pylo/core";

export { PyloError } from "@pylo/core";

"use client";

import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseMutationOptions,
  type InfiniteData,
} from "@tanstack/react-query";
import { buildListQuery, buildByIdQuery, mergeHeaders, flagsToHeaders, capitalize } from "@pylo/core";
import {
  buildUpsertMutation,
  buildBulkUpsertMutation,
  buildDeleteMutation,
  buildIngestEventsMutation,
  buildEventListQuery,
  buildEventPropertyKeysQuery,
  buildEventFieldValuesQuery,
} from "@pylo/core";
import type {
  PaginationData,
  PyloEvent,
  PyloEventInput,
  FilterInput,
  EntityName,
  EntitySelect,
  EntityResult,
  ListOptions,
  ByIdOptions,
  UpsertInput,
  StrictSelect,
  RequestOptions,
  MutationRequestOptions,
  EventListOptions,
  PyloEventListResult,
  PyloEventProperty,
  PyloEventFieldValue,
  PyloEventPropertyKeysOptions,
  PyloEventFieldValuesOptions,
} from "@pylo/core";

interface HooksOptions {
  apiPath?: string;
  headers?: Record<string, string>;
}

interface ListHookResult<T> {
  data: T[] | undefined;
  pagination: PaginationData | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: UseQueryResult["refetch"];
}

type InfiniteListOptions<S, E extends EntityName<S>, Sel extends EntitySelect<S, E>> = {
  perPage?: number;
  select: StrictSelect<Sel, EntitySelect<S, E>>;
  filter?: FilterInput;
} & RequestOptions;

interface PageData {
  data: unknown[];
  pagination: PaginationData;
}

async function clientFetch(
  apiPath: string,
  query: string,
  variables: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<unknown> {
  const response = await fetch(apiPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      variables,
      ...(headers !== undefined ? { headers } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as {
    data?: unknown;
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join(", "));
  }

  return json.data;
}

export function createPyloHooks<S>(options: HooksOptions) {
  const apiPath = options.apiPath ?? "/api/graphql";
  const globalHeaders = options.headers;

  function usePyloList<
    E extends EntityName<S>,
    Sel extends EntitySelect<S, E>,
  >(
    entity: E,
    queryOptions: ListOptions<S, E, Sel> & RequestOptions,
  ): ListHookResult<EntityResult<S, E, Sel>> {
    const merged = mergeHeaders(globalHeaders, queryOptions?.headers);
    const queryKey = [
      "pylo",
      entity,
      "list",
      {
        filter: queryOptions?.filter,
        pagination: queryOptions?.pagination,
        select: queryOptions?.select,
        headers: merged,
      },
    ];

    const result = useQuery({
      queryKey,
      queryFn: async () => {
        const { query, variables } = buildListQuery(
          entity as string,
          queryOptions as unknown as Record<string, unknown> | undefined,
        );

        const data = (await clientFetch(apiPath, query, variables, merged)) as Record<
          string,
          { data: unknown[]; pagination: PaginationData }
        >;

        const listKey = `${entity as string}List`;
        return data[listKey]!;
      },
    });

    return {
      data: (result.data?.data ?? undefined) as EntityResult<S, E, Sel>[] | undefined,
      pagination: result.data?.pagination,
      isLoading: result.isLoading,
      error: result.error,
      refetch: result.refetch,
    };
  }

  function usePyloInfiniteList<
    E extends EntityName<S>,
    Sel extends EntitySelect<S, E>,
  >(
    entity: E,
    infiniteOptions: InfiniteListOptions<S, E, Sel>,
  ): UseInfiniteQueryResult<{
    data: Array<EntityResult<S, E, Sel>>;
    pages: Array<{
      data: Array<EntityResult<S, E, Sel>>;
      pagination: PaginationData;
    }>;
  }> {
    const perPage = infiniteOptions?.perPage ?? 20;
    const merged = mergeHeaders(globalHeaders, infiniteOptions?.headers);

    return useInfiniteQuery({
      queryKey: [
        "pylo",
        entity,
        "infiniteList",
        {
          perPage,
          filter: infiniteOptions?.filter,
          select: infiniteOptions?.select,
          headers: merged,
        },
      ],
      queryFn: async ({ pageParam }: { pageParam: number }) => {
        const runtimeOptions = {
          select: infiniteOptions?.select,
          filter: infiniteOptions?.filter,
          pagination: { page: pageParam, per_page: perPage },
        };

        const { query, variables } = buildListQuery(
          entity as string,
          runtimeOptions as Record<string, unknown>,
        );

        const data = (await clientFetch(apiPath, query, variables, merged)) as Record<
          string,
          PageData
        >;

        const listKey = `${entity as string}List`;
        return data[listKey]!;
      },
      initialPageParam: 1,
      getNextPageParam: (lastPage: PageData) => {
        if (lastPage.pagination.has_more_pages) {
          return lastPage.pagination.current_page + 1;
        }
        return undefined;
      },
      select: (queryData: InfiniteData<PageData, number>) => {
        const allData = queryData.pages.flatMap(
          (page: PageData) => page.data,
        ) as Array<EntityResult<S, E, Sel>>;

        return {
          ...queryData,
          data: allData,
          pages: queryData.pages as Array<{
            data: Array<EntityResult<S, E, Sel>>;
            pagination: PaginationData;
          }>,
        };
      },
    }) as UseInfiniteQueryResult<{
      data: Array<EntityResult<S, E, Sel>>;
      pages: Array<{
        data: Array<EntityResult<S, E, Sel>>;
        pagination: PaginationData;
      }>;
    }>;
  }

  function usePyloById<
    E extends EntityName<S>,
    Sel extends EntitySelect<S, E>,
  >(
    entity: E,
    id: string | null | undefined,
    queryOptions: ByIdOptions<S, E, Sel> & RequestOptions,
  ): UseQueryResult<EntityResult<S, E, Sel> | null> {
    const merged = mergeHeaders(globalHeaders, queryOptions?.headers);
    return useQuery({
      queryKey: ["pylo", entity, "byId", id, { select: queryOptions?.select, headers: merged }],
      queryFn: async () => {
        const { query, variables } = buildByIdQuery(
          entity as string,
          id!,
          queryOptions as unknown as Record<string, unknown> | undefined,
        );

        const data = (await clientFetch(apiPath, query, variables, merged)) as Record<
          string,
          { data: unknown } | null
        >;

        const byIdKey = `${entity as string}ById`;
        const result = data[byIdKey];
        if (!result) return null;

        return result.data as EntityResult<S, E, Sel>;
      },
      enabled: !!id,
    });
  }

  function usePyloUpsert<E extends EntityName<S>>(
    entity: E,
    mutationOptions?: Omit<
      UseMutationOptions<{ id: string }, Error, UpsertInput<S, E>>,
      "mutationFn"
    > & MutationRequestOptions,
  ): UseMutationResult<{ id: string }, Error, UpsertInput<S, E>> {
    const queryClient = useQueryClient();
    const merged = mergeHeaders(
      mergeHeaders(globalHeaders, mutationOptions?.headers),
      flagsToHeaders(mutationOptions ?? {}),
    );
    const isDryRun = mutationOptions?.dryRun === true;

    return useMutation({
      ...mutationOptions,
      mutationFn: async (input: UpsertInput<S, E>) => {
        const pascalName = capitalize(entity as string);

        const { query, variables } = buildUpsertMutation(
          entity as string,
          pascalName,
          input as Record<string, unknown>,
        );

        const data = (await clientFetch(apiPath, query, variables, merged)) as Record<
          string,
          { data: { id: string } }
        >;

        const mutationKey = `update${pascalName}`;
        return data[mutationKey]!.data;
      },
      onSuccess: (data, variables, onMutateResult, context) => {
        if (!isDryRun) {
          void queryClient.invalidateQueries({
            queryKey: ["pylo", entity],
          });
        }
        mutationOptions?.onSuccess?.(data, variables, onMutateResult, context);
      },
    });
  }

  // Upserts many rows of one entity in a single all-or-nothing transaction.
  // Rows without an `id`/`__search_value` are created; the ids of the affected
  // rows are returned in input order.
  function usePyloBulkUpsert<E extends EntityName<S>>(
    entity: E,
    mutationOptions?: Omit<
      UseMutationOptions<{ id: string }[], Error, UpsertInput<S, E>[]>,
      "mutationFn"
    > & MutationRequestOptions,
  ): UseMutationResult<{ id: string }[], Error, UpsertInput<S, E>[]> {
    const queryClient = useQueryClient();
    const merged = mergeHeaders(
      mergeHeaders(globalHeaders, mutationOptions?.headers),
      flagsToHeaders(mutationOptions ?? {}),
    );
    const isDryRun = mutationOptions?.dryRun === true;

    return useMutation({
      ...mutationOptions,
      mutationFn: async (inputs: UpsertInput<S, E>[]) => {
        const pascalName = capitalize(entity as string);

        const { query, variables } = buildBulkUpsertMutation(
          entity as string,
          pascalName,
          inputs as Record<string, unknown>[],
        );

        const data = (await clientFetch(apiPath, query, variables, merged)) as Record<
          string,
          { data: { id: string }[] }
        >;

        const mutationKey = `bulkUpdate${pascalName}`;
        return data[mutationKey]!.data;
      },
      onSuccess: (data, variables, onMutateResult, context) => {
        if (!isDryRun) {
          void queryClient.invalidateQueries({
            queryKey: ["pylo", entity],
          });
        }
        mutationOptions?.onSuccess?.(data, variables, onMutateResult, context);
      },
    });
  }

  function usePyloDelete<E extends EntityName<S>>(
    entity: E,
    mutationOptions?: Omit<
      UseMutationOptions<{ success: boolean }, Error, string[]>,
      "mutationFn"
    > & MutationRequestOptions,
  ): UseMutationResult<{ success: boolean }, Error, string[]> {
    const queryClient = useQueryClient();
    const merged = mergeHeaders(
      mergeHeaders(globalHeaders, mutationOptions?.headers),
      flagsToHeaders(mutationOptions ?? {}),
    );
    const isDryRun = mutationOptions?.dryRun === true;

    return useMutation({
      ...mutationOptions,
      mutationFn: async (ids: string[]) => {
        const pascalName = capitalize(entity as string);

        const { query, variables } = buildDeleteMutation(
          entity as string,
          pascalName,
          ids,
        );

        const data = (await clientFetch(apiPath, query, variables, merged)) as Record<
          string,
          { data: { success: boolean } }
        >;

        const mutationKey = `delete${pascalName}`;
        return data[mutationKey]!.data;
      },
      onSuccess: (data, variables, onMutateResult, context) => {
        if (!isDryRun) {
          void queryClient.invalidateQueries({
            queryKey: ["pylo", entity],
          });
        }
        mutationOptions?.onSuccess?.(data, variables, onMutateResult, context);
      },
    });
  }

  // Event names are namespaced under "custom." by the backend (the prefix is
  // added if missing) and `ts` is server-generated.
  function usePyloIngestEvents(
    mutationOptions?: Omit<
      UseMutationOptions<PyloEvent[], Error, PyloEventInput[]>,
      "mutationFn"
    > & MutationRequestOptions,
  ): UseMutationResult<PyloEvent[], Error, PyloEventInput[]> {
    const merged = mergeHeaders(
      mergeHeaders(globalHeaders, mutationOptions?.headers),
      flagsToHeaders(mutationOptions ?? {}),
    );

    return useMutation({
      ...mutationOptions,
      mutationFn: async (events: PyloEventInput[]) => {
        const { query, variables } = buildIngestEventsMutation(events);

        const data = (await clientFetch(apiPath, query, variables, merged)) as Record<
          string,
          { data: PyloEvent[] }
        >;

        return data["ingestPyloEventData"]!.data;
      },
    });
  }

  // Reads custom events. In list mode returns raw event rows; when
  // `filter.dimensions` / `interval` / `group_by` are set, returns grouped
  // rows plus grand-total `aggregations`.
  function usePyloEventList(
    queryOptions?: EventListOptions & RequestOptions,
  ): UseQueryResult<PyloEventListResult> {
    const merged = mergeHeaders(globalHeaders, queryOptions?.headers);
    return useQuery({
      queryKey: ["pylo", "events", "list", { ...queryOptions, headers: merged }],
      queryFn: async () => {
        const { query, variables } = buildEventListQuery(queryOptions);

        const data = (await clientFetch(apiPath, query, variables, merged)) as Record<
          string,
          PyloEventListResult
        >;

        return data["pyloEventList"]!;
      },
    });
  }

  // Infers the property paths (and JSON types) present across recent events.
  function usePyloEventPropertyKeys(
    queryOptions?: PyloEventPropertyKeysOptions & RequestOptions,
  ): UseQueryResult<PyloEventProperty[]> {
    const merged = mergeHeaders(globalHeaders, queryOptions?.headers);
    return useQuery({
      queryKey: [
        "pylo",
        "events",
        "propertyKeys",
        { filter: queryOptions?.filter, headers: merged },
      ],
      queryFn: async () => {
        const { query, variables } = buildEventPropertyKeysQuery(queryOptions);

        const data = (await clientFetch(apiPath, query, variables, merged)) as Record<
          string,
          PyloEventProperty[]
        >;

        return data["pyloEventPropertyKeys"] ?? [];
      },
    });
  }

  // The most frequent distinct values of a single field, with their counts.
  // Disabled until `field` is set.
  function usePyloEventFieldValues(
    field: string | null | undefined,
    queryOptions?: PyloEventFieldValuesOptions & RequestOptions,
  ): UseQueryResult<PyloEventFieldValue[]> {
    const merged = mergeHeaders(globalHeaders, queryOptions?.headers);
    return useQuery({
      queryKey: [
        "pylo",
        "events",
        "fieldValues",
        field,
        {
          startTime: queryOptions?.startTime,
          limit: queryOptions?.limit,
          headers: merged,
        },
      ],
      queryFn: async () => {
        const { query, variables } = buildEventFieldValuesQuery(field!, queryOptions);

        const data = (await clientFetch(apiPath, query, variables, merged)) as Record<
          string,
          PyloEventFieldValue[]
        >;

        return data["pyloEventFieldValues"] ?? [];
      },
      enabled: !!field,
    });
  }

  return {
    usePyloList,
    usePyloInfiniteList,
    usePyloById,
    usePyloUpsert,
    usePyloBulkUpsert,
    usePyloDelete,
    usePyloIngestEvents,
    usePyloEventList,
    usePyloEventPropertyKeys,
    usePyloEventFieldValues,
  };
}

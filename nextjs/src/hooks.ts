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
import { buildListQuery, buildByIdQuery } from "@pylo/core";
import { buildUpsertMutation, buildDeleteMutation } from "@pylo/core";
import type {
  SchemaMetadata,
  PaginationData,
  FilterInput,
  EntityName,
  EntitySelect,
  EntityResult,
  ListOptions,
  ByIdOptions,
  UpsertInput,
  StrictSelect,
} from "@pylo/core";

interface HooksOptions {
  apiPath?: string;
  schemaMetadata: SchemaMetadata;
}

interface ListHookResult<T> {
  data: T[] | undefined;
  pagination: PaginationData | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: UseQueryResult["refetch"];
}

type InfiniteListOptions<S, E extends EntityName<S>, Sel extends EntitySelect<S, E> | undefined = undefined> = {
  perPage?: number;
  select?: Sel extends undefined
    ? EntitySelect<S, E>
    : StrictSelect<Sel, EntitySelect<S, E>>;
  filter?: FilterInput;
};

interface PageData {
  data: unknown[];
  pagination: PaginationData;
}

async function clientFetch(
  apiPath: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(apiPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
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
  const metadata = options.schemaMetadata;

  function usePyloList<
    E extends EntityName<S>,
    Sel extends EntitySelect<S, E> | undefined = undefined,
  >(
    entity: E,
    queryOptions?: ListOptions<S, E, Sel>,
  ): ListHookResult<EntityResult<S, E, Sel>> {
    const queryKey = [
      "pylo",
      entity,
      "list",
      {
        filter: queryOptions?.filter,
        pagination: queryOptions?.pagination,
        select: queryOptions?.select,
      },
    ];

    const result = useQuery({
      queryKey,
      queryFn: async () => {
        const { query, variables } = buildListQuery(
          entity as string,
          queryOptions as Record<string, unknown> | undefined,
          metadata,
        );

        const data = (await clientFetch(apiPath, query, variables)) as Record<
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
    Sel extends EntitySelect<S, E> | undefined = undefined,
  >(
    entity: E,
    infiniteOptions?: InfiniteListOptions<S, E, Sel>,
  ): UseInfiniteQueryResult<{
    data: Array<EntityResult<S, E, Sel>>;
    pages: Array<{
      data: Array<EntityResult<S, E, Sel>>;
      pagination: PaginationData;
    }>;
  }> {
    const perPage = infiniteOptions?.perPage ?? 20;

    return useInfiniteQuery({
      queryKey: [
        "pylo",
        entity,
        "infiniteList",
        {
          perPage,
          filter: infiniteOptions?.filter,
          select: infiniteOptions?.select,
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
          metadata,
        );

        const data = (await clientFetch(apiPath, query, variables)) as Record<
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
    Sel extends EntitySelect<S, E> | undefined = undefined,
  >(
    entity: E,
    id: string | null | undefined,
    queryOptions?: ByIdOptions<S, E, Sel>,
  ): UseQueryResult<EntityResult<S, E, Sel> | null> {
    return useQuery({
      queryKey: ["pylo", entity, "byId", id, { select: queryOptions?.select }],
      queryFn: async () => {
        const { query, variables } = buildByIdQuery(
          entity as string,
          id!,
          queryOptions as Record<string, unknown> | undefined,
          metadata,
        );

        const data = (await clientFetch(apiPath, query, variables)) as Record<
          string,
          { data: unknown } | null
        >;

        const result = data[entity as string];
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
    >,
  ): UseMutationResult<{ id: string }, Error, UpsertInput<S, E>> {
    const queryClient = useQueryClient();

    return useMutation({
      ...mutationOptions,
      mutationFn: async (input: UpsertInput<S, E>) => {
        const entityMeta = metadata.entities[entity as string];
        if (!entityMeta) {
          throw new Error(`Unknown entity: ${entity as string}`);
        }

        const { query, variables } = buildUpsertMutation(
          entity as string,
          entityMeta.pascalName,
          input as Record<string, unknown>,
        );

        const data = (await clientFetch(apiPath, query, variables)) as Record<
          string,
          { data: { id: string } }
        >;

        const mutationKey = `update${entityMeta.pascalName}`;
        return data[mutationKey]!.data;
      },
      onSuccess: (data, variables, onMutateResult, context) => {
        void queryClient.invalidateQueries({
          queryKey: ["pylo", entity],
        });
        mutationOptions?.onSuccess?.(data, variables, onMutateResult, context);
      },
    });
  }

  function usePyloDelete<E extends EntityName<S>>(
    entity: E,
    mutationOptions?: Omit<
      UseMutationOptions<{ success: boolean }, Error, string[]>,
      "mutationFn"
    >,
  ): UseMutationResult<{ success: boolean }, Error, string[]> {
    const queryClient = useQueryClient();

    return useMutation({
      ...mutationOptions,
      mutationFn: async (ids: string[]) => {
        const entityMeta = metadata.entities[entity as string];
        if (!entityMeta) {
          throw new Error(`Unknown entity: ${entity as string}`);
        }

        const { query, variables } = buildDeleteMutation(
          entity as string,
          entityMeta.pascalName,
          ids,
        );

        const data = (await clientFetch(apiPath, query, variables)) as Record<
          string,
          { data: { success: boolean } }
        >;

        const mutationKey = `delete${entityMeta.pascalName}`;
        return data[mutationKey]!.data;
      },
      onSuccess: (data, variables, onMutateResult, context) => {
        void queryClient.invalidateQueries({
          queryKey: ["pylo", entity],
        });
        mutationOptions?.onSuccess?.(data, variables, onMutateResult, context);
      },
    });
  }

  return {
    usePyloList,
    usePyloInfiniteList,
    usePyloById,
    usePyloUpsert,
    usePyloDelete,
  };
}

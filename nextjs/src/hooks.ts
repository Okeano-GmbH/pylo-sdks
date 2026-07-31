"use client";

import { useCallback, useRef, useState } from "react";
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
import {
  buildListQuery,
  buildByIdQuery,
  buildMeQuery,
  mergeHeaders,
  flagsToHeaders,
  capitalize,
  toAggregateResult,
} from "@pylo/core";
import {
  buildUpsertMutation,
  buildBulkUpsertMutation,
  buildDeleteMutation,
  buildIngestEventsMutation,
  buildEntityAggregateQuery,
  buildEventAggregateQuery,
  buildEventListQuery,
  buildEventPropertyKeysQuery,
  buildEventFieldValuesQuery,
} from "@pylo/core";
import {
  CREATE_UPLOAD_MUTATION,
  CREATE_DOWNLOAD_MUTATION,
  buildCreateUploadInput,
  buildAttachMutation,
  uploadToUrl,
} from "@pylo/core";
import type {
  UploadUrl,
  UploadProgress,
  UploadAttachTarget,
  PyloUploadedFile,
  EntityRelationPath,
} from "@pylo/core";
import type {
  PaginationData,
  PyloEvent,
  PyloEventInput,
  FilterInput,
  EntityName,
  CallableEntityName,
  EntitySelect,
  EntityResult,
  ListOptions,
  ByIdOptions,
  UpsertInput,
  SelectConstraint,
  RequestOptions,
  MutationRequestOptions,
  EventListOptions,
  PyloEventListResult,
  PyloEventProperty,
  PyloEventFieldValue,
  PyloEventPropertyKeysOptions,
  PyloEventFieldValuesOptions,
  AggregateMetricInput,
  AggregateGroupByInput,
  AggregateOptions,
  AggregateResult,
  EventAggregateOptions,
  EventMetricInput,
  EventGroupByInput,
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

type InfiniteListOptions<S, E extends CallableEntityName<S>, Sel extends EntitySelect<S, E>> = {
  perPage?: number;
  select: Sel;
  filter?: FilterInput;
} & RequestOptions;

interface PageData {
  data: unknown[];
  pagination: PaginationData;
}

interface UploadHookOptions<S> {
  /**
   * The pyloMedia relation the files are destined for, e.g. `"contact.avatar"`.
   * The relation's mime-type/extension allowlists are enforced on upload.
   * Omit to upload unrestricted, unattached media.
   */
  entityRelationPath?: EntityRelationPath<S>;
  /** Create persistent public download URLs (no JWT). Requires `entityRelationPath`. */
  isPublic?: boolean;
  onProgress?: (progress: UploadProgress) => void;
  onSuccess?: (files: PyloUploadedFile[]) => void;
  onError?: (error: Error) => void;
  headers?: Record<string, string>;
}

interface StartUploadOptions<S> {
  entityRelationPath?: EntityRelationPath<S>;
  isPublic?: boolean;
  /** Attach the uploaded file(s) to this record via the `entityRelationPath` relation. */
  attachTo?: UploadAttachTarget;
}

interface UploadHookResult<S> {
  /** Uploads one or more files; resolves with the created pyloMedia rows. */
  startUpload: (
    files: File | File[],
    overrides?: StartUploadOptions<S>,
  ) => Promise<PyloUploadedFile[]>;
  isUploading: boolean;
  /** 0–100, aggregated by bytes across all files of the current batch. */
  progress: number;
  error: Error | null;
  /** Results of the last successful batch. */
  uploadedFiles: PyloUploadedFile[];
  /** Cancels the in-flight batch. */
  abort: () => void;
  /** Clears progress, error, and results. */
  reset: () => void;
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
    E extends CallableEntityName<S>,
    const Sel extends SelectConstraint<S, E, Sel>,
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
    E extends CallableEntityName<S>,
    const Sel extends SelectConstraint<S, E, Sel>,
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
    E extends CallableEntityName<S>,
    const Sel extends SelectConstraint<S, E, Sel>,
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

  // `me` is a virtual entity: it has no list/byId endpoints, so it is read
  // through its own query. Types exactly like `usePyloById` — same required
  // `select`, same result inference — minus the id, which the server resolves
  // from the request credentials.
  function usePyloMe<
    const Sel extends SelectConstraint<S, "me" & EntityName<S>, Sel>,
  >(
    queryOptions: ByIdOptions<S, "me" & EntityName<S>, Sel> & RequestOptions,
  ): UseQueryResult<EntityResult<S, "me" & EntityName<S>, Sel>> {
    const merged = mergeHeaders(globalHeaders, queryOptions?.headers);
    return useQuery({
      queryKey: ["pylo", "me", { select: queryOptions?.select, headers: merged }],
      queryFn: async () => {
        const { query, variables } = buildMeQuery(
          queryOptions as unknown as Record<string, unknown> | undefined,
        );

        const data = (await clientFetch(apiPath, query, variables, merged)) as Record<
          string,
          unknown
        >;

        // Unlike `<entity>ById`, `me` is not wrapped in a `data` envelope.
        return data["me"] as EntityResult<S, "me" & EntityName<S>, Sel>;
      },
    });
  }

  // Aggregate an entity: `metrics` keyed by alias, `groupBy` for breakdowns.
  // Resolves to `{ rows, total }` with the aliases you wrote typed on both.
  //
  // `E` is `EntityName`, not `CallableEntityName` — system entities have no
  // list/byId endpoints but can still be aggregated.
  function usePyloAggregate<
    E extends EntityName<S>,
    const M extends Record<string, AggregateMetricInput<S, E>>,
    const G extends readonly AggregateGroupByInput<S, E>[] = [],
  >(
    entity: E,
    queryOptions: AggregateOptions<S, E, M, G> & RequestOptions,
  ): UseQueryResult<AggregateResult<M, G>> {
    const merged = mergeHeaders(globalHeaders, queryOptions?.headers);
    return useQuery({
      queryKey: [
        "pylo",
        entity,
        "aggregate",
        {
          metrics: queryOptions?.metrics,
          groupBy: queryOptions?.groupBy,
          filter: queryOptions?.filter,
          limit: queryOptions?.limit,
          headers: merged,
        },
      ],
      queryFn: async () => {
        const { query, variables } = buildEntityAggregateQuery(
          capitalize(entity as string),
          queryOptions as unknown as Record<string, unknown>,
        );

        const data = (await clientFetch(apiPath, query, variables, merged)) as Record<
          string,
          { rows: unknown; total: unknown }
        >;

        const result = data["entityInstanceAggregate"]!;
        return toAggregateResult(
          result.rows,
          result.total,
          queryOptions,
        ) as unknown as AggregateResult<M, G>;
      },
    });
  }

  // The event-store counterpart. Same options and the same `{ rows, total }`
  // result — the endpoint's `data` / `aggregations` envelope is normalized away.
  function usePyloEventAggregate<
    const M extends Record<string, EventMetricInput>,
    const G extends readonly EventGroupByInput[] = [],
  >(
    queryOptions: EventAggregateOptions<M, G> & RequestOptions,
  ): UseQueryResult<AggregateResult<M, G>> {
    const merged = mergeHeaders(globalHeaders, queryOptions?.headers);
    return useQuery({
      queryKey: [
        "pylo",
        "events",
        "aggregate",
        {
          metrics: queryOptions?.metrics,
          groupBy: queryOptions?.groupBy,
          filter: queryOptions?.filter,
          limit: queryOptions?.limit,
          startTime: queryOptions?.startTime,
          headers: merged,
        },
      ],
      queryFn: async () => {
        const { query, variables } = buildEventAggregateQuery(
          queryOptions as unknown as Record<string, unknown>,
        );

        const data = (await clientFetch(apiPath, query, variables, merged)) as Record<
          string,
          { data: unknown; aggregations: unknown }
        >;

        const result = data["pyloEventList"]!;
        return toAggregateResult(
          result.data,
          result.aggregations,
          queryOptions,
        ) as unknown as AggregateResult<M, G>;
      },
    });
  }

  function usePyloUpsert<E extends CallableEntityName<S>>(
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
  function usePyloBulkUpsert<E extends CallableEntityName<S>>(
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

  function usePyloDelete<E extends CallableEntityName<S>>(
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

  // Uploads files through the Pylo two-step flow: requests an upload URL via
  // the API route (`createUpload`), then POSTs the bytes straight
  // from the browser to the returned fileservice URL (the expiring JWT in the
  // URL is the credential, so no bytes pass through the app server). Progress
  // is byte-accurate via XMLHttpRequest.
  function usePyloUpload(hookOptions?: UploadHookOptions<S>): UploadHookResult<S> {
    const queryClient = useQueryClient();
    const [isUploading, setIsUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<Error | null>(null);
    const [uploadedFiles, setUploadedFiles] = useState<PyloUploadedFile[]>([]);
    const abortRef = useRef<AbortController | null>(null);

    // Latest options without re-creating startUpload on every render.
    const optionsRef = useRef(hookOptions);
    optionsRef.current = hookOptions;

    const startUpload = useCallback(
      async (
        files: File | File[],
        overrides?: StartUploadOptions<S>,
      ): Promise<PyloUploadedFile[]> => {
        const opts = { ...optionsRef.current, ...overrides };
        const merged = mergeHeaders(globalHeaders, opts.headers);
        const list = Array.isArray(files) ? files : [files];
        if (list.length === 0) return [];

        const controller = new AbortController();
        abortRef.current = controller;
        setIsUploading(true);
        setProgress(0);
        setError(null);
        setUploadedFiles([]);

        const grandTotal = list.reduce((sum, file) => sum + file.size, 0);
        const loadedPerFile: number[] = new Array<number>(list.length).fill(0);
        const reportProgress = () => {
          const loaded = loadedPerFile.reduce((sum, bytes) => sum + bytes, 0);
          const percent =
            grandTotal > 0 ? Math.round((loaded / grandTotal) * 100) : 0;
          setProgress(percent);
          optionsRef.current?.onProgress?.({ loaded, total: grandTotal, percent });
        };

        try {
          // Same pre-flight the server client runs — also rejects a multi-file
          // batch aimed at a `"set"` relation before any bytes are sent.
          const input = buildCreateUploadInput(opts, list.length);

          const results = await Promise.all(
            list.map(async (file, index) => {
              const data = (await clientFetch(
                apiPath,
                CREATE_UPLOAD_MUTATION,
                { input },
                merged,
              )) as { createUpload: UploadUrl };
              const uploadUrl = data.createUpload;

              await uploadToUrl(uploadUrl.url, file, file.name, {
                signal: controller.signal,
                onProgress: (fileProgress) => {
                  loadedPerFile[index] = fileProgress.loaded;
                  reportProgress();
                },
              });
              loadedPerFile[index] = file.size;
              reportProgress();

              return {
                id: uploadUrl.id,
                fileName: file.name,
                mimeType: file.type || undefined,
                size: file.size,
              } satisfies PyloUploadedFile;
            }),
          );

          // One attach mutation for the whole batch — per-file upserts against
          // the same record would race and overwrite each other.
          if (opts.attachTo) {
            const { query, variables, entityKey } = buildAttachMutation(
              opts.entityRelationPath as string,
              results.map((result) => result.id),
              opts.attachTo,
            );
            await clientFetch(apiPath, query, variables, merged);
            void queryClient.invalidateQueries({ queryKey: ["pylo", entityKey] });
          }

          // New pyloMedia rows exist now — refresh any media lists.
          void queryClient.invalidateQueries({ queryKey: ["pylo", "pyloMedia"] });
          setUploadedFiles(results);
          setProgress(100);
          optionsRef.current?.onSuccess?.(results);
          return results;
        } catch (thrown) {
          // Stop the siblings still in flight. Left running they would finish
          // in the background and create pyloMedia rows whose ids the caller
          // never receives — unreachable files nobody can clean up.
          controller.abort();
          const uploadError =
            thrown instanceof Error ? thrown : new Error(String(thrown));
          setError(uploadError);
          optionsRef.current?.onError?.(uploadError);
          throw uploadError;
        } finally {
          setIsUploading(false);
          // Only if a newer batch hasn't already claimed the slot.
          if (abortRef.current === controller) abortRef.current = null;
        }
      },
      [queryClient],
    );

    const abort = useCallback(() => {
      abortRef.current?.abort();
    }, []);

    const reset = useCallback(() => {
      setIsUploading(false);
      setProgress(0);
      setError(null);
      setUploadedFiles([]);
    }, []);

    return { startUpload, isUploading, progress, error, uploadedFiles, abort, reset };
  }

  // Creates a short-lived download URL for a pyloMedia id via `createDownload`.
  // Private-file URLs expire (default TTL ~5 minutes), so the result goes
  // stale after 4 minutes and refetches on next use — tune `staleTimeMs` if
  // the relation overrides its download TTL.
  function usePyloFileUrl(
    id: string | null | undefined,
    queryOptions?: { staleTimeMs?: number } & RequestOptions,
  ): UseQueryResult<string> {
    const merged = mergeHeaders(globalHeaders, queryOptions?.headers);
    return useQuery({
      queryKey: ["pylo", "files", "downloadUrl", id, { headers: merged }],
      queryFn: async () => {
        const data = (await clientFetch(
          apiPath,
          CREATE_DOWNLOAD_MUTATION,
          { id: id! },
          merged,
        )) as { createDownload: { id: string; url: string } };

        return data.createDownload.url;
      },
      enabled: !!id,
      staleTime: queryOptions?.staleTimeMs ?? 4 * 60 * 1000,
    });
  }

  return {
    usePyloList,
    usePyloInfiniteList,
    usePyloById,
    usePyloMe,
    usePyloAggregate,
    usePyloEventAggregate,
    usePyloUpsert,
    usePyloBulkUpsert,
    usePyloDelete,
    usePyloIngestEvents,
    usePyloEventList,
    usePyloEventPropertyKeys,
    usePyloEventFieldValues,
    usePyloUpload,
    usePyloFileUrl,
  };
}

// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { RealtimeClient, RealtimeEvent, RealtimeHandlers } from "@pylo/core";
import { createPyloHooks } from "../src/hooks.js";
import type { LiveRealtime } from "../src/provider.js";

interface Schema {
  contact: {
    fields: { id: string; name: string; rank: number };
    relations: Record<never, never>;
    updateInput: { id?: string; name?: string };
  };
}

interface FakeSubscription {
  entity: string;
  options: { select: unknown; filter?: unknown };
  handlers: RealtimeHandlers;
  unsubscribed: boolean;
}

function setup(rows: Array<Record<string, unknown>>, options?: { headers?: Record<string, string> }) {
  const subscriptions: FakeSubscription[] = [];
  let live = true;
  const client = {
    subscribe: (entity: string, opts: FakeSubscription["options"], handlers: RealtimeHandlers) => {
      const sub: FakeSubscription = { entity, options: opts, handlers, unsubscribed: false };
      subscriptions.push(sub);
      return { ready: Promise.resolve(), unsubscribe: () => (sub.unsubscribed = true) };
    },
    isLive: () => live,
  } as unknown as RealtimeClient;
  const realtime: LiveRealtime = { client, liveQueries: new Map() };

  let current = rows;
  const transport = vi.fn(async (query: string) => {
    if (query.includes("contactList")) return { contactList: { data: current, pagination: { total: current.length } } };
    if (query.includes("contactById")) return { contactById: { data: current[0] ?? null } };
    if (query.includes("entityInstanceAggregate")) return { entityInstanceAggregate: { rows: [], total: { n: current.length } } };
    if (query.includes("upsertContact")) return { upsertContact: { data: { id: "x" } } };
    throw new Error(`unexpected query ${query}`);
  });

  const hooks = createPyloHooks<Schema>({
    useTransport: () => transport,
    useRealtime: () => realtime,
    ...(options?.headers ? { headers: options.headers } : {}),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const emit = (event: RealtimeEvent, index = subscriptions.length - 1) =>
    act(() => subscriptions[index]!.handlers.onEvent(event));
  const calls = (needle: string) => transport.mock.calls.filter(([q]) => q.includes(needle)).length;

  return {
    hooks,
    wrapper,
    realtime,
    subscriptions,
    emit,
    calls,
    setRows: (next: Array<Record<string, unknown>>) => (current = next),
    setLive: (value: boolean) => (live = value),
  };
}

afterEach(() => cleanup());

describe("usePyloList — live", () => {
  it("subscribes with the query's own select and filter", async () => {
    const t = setup([{ id: "a", name: "Ada" }]);
    const filter = { query: [{ condition: { field: "name", operator: "ilike" as const, value: "a%" } }] };
    renderHook(() => t.hooks.usePyloList("contact", { select: { name: true }, filter, live: true }), {
      wrapper: t.wrapper,
    });

    expect(t.subscriptions).toHaveLength(1);
    expect(t.subscriptions[0]).toMatchObject({ entity: "contact", options: { select: { name: true }, filter } });
  });

  it("does not subscribe without `live`", () => {
    const t = setup([]);
    renderHook(() => t.hooks.usePyloList("contact", { select: { name: true } }), { wrapper: t.wrapper });
    expect(t.subscriptions).toHaveLength(0);
  });

  it("patches an update into the cache without refetching", async () => {
    const t = setup([{ id: "a", name: "Ada" }]);
    const { result } = renderHook(
      () => t.hooks.usePyloList("contact", { select: { name: true }, live: true }),
      { wrapper: t.wrapper },
    );
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    t.emit({ kind: "update", id: "a", removed: false, data: { id: "a", name: "Ann" } });

    await waitFor(() => expect(result.current.data).toEqual([{ id: "a", name: "Ann" }]));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(t.calls("contactList")).toBe(1);
  });

  it("refetches in the background when the cache can't place a row", async () => {
    const t = setup([{ id: "a", name: "Ada" }]);
    const { result } = renderHook(
      () =>
        t.hooks.usePyloList("contact", {
          select: { name: true },
          filter: { sortby: [{ field: "name", order: "asc" }] },
          live: true,
        }),
      { wrapper: t.wrapper },
    );
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    t.setRows([{ id: "a", name: "Ada" }, { id: "b", name: "Bea" }]);
    t.emit({ kind: "create", id: "b", removed: false, data: { id: "b", name: "Bea" } });
    t.emit({ kind: "create", id: "c", removed: false, data: { id: "c", name: "Cy" } });

    expect(result.current.data).toHaveLength(1);
    await waitFor(() => expect(result.current.data).toHaveLength(2), { timeout: 3_000 });
    expect(t.calls("contactList")).toBe(2);
  });

  it("refetches after a reconnect", async () => {
    const t = setup([{ id: "a", name: "Ada" }]);
    const { result } = renderHook(
      () => t.hooks.usePyloList("contact", { select: { name: true }, live: true }),
      { wrapper: t.wrapper },
    );
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    t.setRows([]);
    act(() => t.subscriptions[0]!.handlers.onResync!());
    await waitFor(() => expect(result.current.data).toEqual([]));
  });

  it("only refetches on events when request headers are set", async () => {
    const t = setup([{ id: "a", name: "Ada" }], { headers: { "pylo-field-variants": "language:de" } });
    const { result } = renderHook(
      () => t.hooks.usePyloList("contact", { select: { name: true }, live: true }),
      { wrapper: t.wrapper },
    );
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    t.emit({ kind: "update", id: "a", removed: false, data: { id: "a", name: "Ann" } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.data).toEqual([{ id: "a", name: "Ada" }]);
    await waitFor(() => expect(t.calls("contactList")).toBe(2), { timeout: 3_000 });
  });

  it("unsubscribes on unmount and forgets the live query", async () => {
    const t = setup([]);
    const { unmount } = renderHook(
      () => t.hooks.usePyloList("contact", { select: { name: true }, live: true }),
      { wrapper: t.wrapper },
    );
    expect(t.realtime.liveQueries.size).toBe(1);
    unmount();
    expect(t.subscriptions[0]!.unsubscribed).toBe(true);
    expect(t.realtime.liveQueries.size).toBe(0);
  });
});

describe("usePyloById — live", () => {
  it("subscribes to that one row and clears it when removed", async () => {
    const t = setup([{ id: "a", name: "Ada" }]);
    const { result } = renderHook(
      () => t.hooks.usePyloById("contact", "a", { select: { name: true }, live: true }),
      { wrapper: t.wrapper },
    );
    await waitFor(() => expect(result.current.data).toEqual({ id: "a", name: "Ada" }));

    expect(t.subscriptions[0]!.options.filter).toEqual({
      query: [{ condition: { field: "id", operator: "equal", value: "a" } }],
    });
    t.emit({ kind: "delete", id: "a", removed: true });
    await waitFor(() => expect(result.current.data).toBeNull());
  });

  it("waits for an id", () => {
    const t = setup([]);
    renderHook(() => t.hooks.usePyloById("contact", null, { select: { name: true }, live: true }), {
      wrapper: t.wrapper,
    });
    expect(t.subscriptions).toHaveLength(0);
  });
});

describe("usePyloInfiniteList — live", () => {
  it("restarts from the first page after a reconnect once many pages are loaded", async () => {
    const t = setup([{ id: "a" }]);
    const { result } = renderHook(
      () => t.hooks.usePyloInfiniteList("contact", { select: { name: true }, live: true }),
      { wrapper: t.wrapper },
    );
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));

    const pages = Array.from({ length: 7 }, (_, i) => ({
      data: [{ id: `r${i}` }],
      pagination: { current_page: i + 1, has_more_pages: true },
    }));
    const key = ["pylo", "contact", "infiniteList", { perPage: 20, filter: undefined, select: { name: true }, headers: undefined }];
    const queryClient = (t.wrapper({ children: null }) as { props: { client: QueryClient } }).props.client;
    act(() => queryClient.setQueryData(key, { pages, pageParams: pages.map((_, i) => i + 1) }));
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(7));

    act(() => t.subscriptions[0]!.handlers.onResync!());
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
  });
});

describe("mutations next to live queries", () => {
  it("skip refetching live queries but refresh everything else of the entity", async () => {
    const t = setup([{ id: "a", name: "Ada" }]);
    const { result } = renderHook(
      () => ({
        list: t.hooks.usePyloList("contact", { select: { name: true }, live: true }),
        count: t.hooks.usePyloAggregate("contact", { metrics: { n: "count" } }),
        upsert: t.hooks.usePyloUpsert("contact"),
      }),
      { wrapper: t.wrapper },
    );
    await waitFor(() => expect(result.current.count.data).toBeDefined());

    await act(() => result.current.upsert.mutateAsync({ name: "Bea" }));
    await waitFor(() => expect(t.calls("entityInstanceAggregate")).toBe(2));
    expect(t.calls("contactList")).toBe(1);
  });

  it("refetch everything while the connection isn't live", async () => {
    const t = setup([{ id: "a", name: "Ada" }]);
    t.setLive(false);
    const { result } = renderHook(
      () => ({
        list: t.hooks.usePyloList("contact", { select: { name: true }, live: true }),
        upsert: t.hooks.usePyloUpsert("contact"),
      }),
      { wrapper: t.wrapper },
    );
    await waitFor(() => expect(result.current.list.data).toHaveLength(1));

    await act(() => result.current.upsert.mutateAsync({ name: "Bea" }));
    await waitFor(() => expect(t.calls("contactList")).toBe(2));
  });
});

describe("usePyloSubscription", () => {
  it("delivers events to the latest handler without resubscribing", async () => {
    const t = setup([]);
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ onEvent }) => t.hooks.usePyloSubscription("contact", { select: { name: true } }, onEvent),
      { wrapper: t.wrapper, initialProps: { onEvent: first } },
    );
    rerender({ onEvent: second });

    t.emit({ kind: "create", id: "a", removed: false, data: { id: "a", name: "Ada" } });
    expect(t.subscriptions).toHaveLength(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ kind: "create", id: "a", removed: false, data: { id: "a", name: "Ada" } });
  });
});

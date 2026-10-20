import type { RealtimeEvent, SortInput } from "@pylo/core";

// How an event changed a cached result. `refetch` asks for a background
// refetch the cache could not be patched correctly without; `soon` when the
// visible order is known to be wrong until it lands.
export interface LiveResult<T> {
  data: T;
  refetch: false | "soon" | "later";
}

interface Row {
  id: string;
  [field: string]: unknown;
}

interface ListData {
  data: Row[];
  pagination?: { total?: number } & Record<string, unknown>;
}

interface PagesData {
  pages: ListData[];
  pageParams: unknown[];
}

// Fields no update can change, so they never move a row.
const IMMUTABLE_SORT_FIELDS = new Set(["id", "integer_id", "created_at"]);

export function applyRowEvent(
  row: Row | null | undefined,
  event: RealtimeEvent,
): LiveResult<Row | null | undefined> {
  if (event.removed) return { data: null, refetch: false };
  return { data: { ...row, ...(event.data as Row) }, refetch: false };
}

export function applyListEvent(
  list: ListData,
  event: RealtimeEvent,
  sortby: SortInput[] | undefined,
): LiveResult<ListData> {
  const result = applyPagesEvent({ pages: [list], pageParams: [1] }, event, sortby);
  return { data: result.data.pages[0]!, refetch: result.refetch };
}

export function applyPagesEvent(
  data: PagesData,
  event: RealtimeEvent,
  sortby: SortInput[] | undefined,
): LiveResult<PagesData> {
  const pageIndex = data.pages.findIndex((page) => page.data.some((row) => row.id === event.id));

  if (event.removed) {
    if (pageIndex === -1) return { data, refetch: false };
    // Server page boundaries shift; a row sliding in from the next page
    // would otherwise leave a gap.
    return {
      data: updatePage(data, pageIndex, (page) =>
        adjustTotal({ ...page, data: page.data.filter((row) => row.id !== event.id) }, pageIndex, -1),
      ),
      refetch: "later",
    };
  }

  const incoming = event.data as Row;

  if (pageIndex !== -1) {
    const page = data.pages[pageIndex]!;
    const current = page.data.find((row) => row.id === event.id)!;
    const merged = { ...current, ...incoming };
    const sort = sortChange(current, merged, sortby);
    // Show the new value and the new position together, not one before the other.
    if (sort === "changed") return { data, refetch: "soon" };
    return {
      data: updatePage(data, pageIndex, (p) => ({
        ...p,
        data: p.data.map((row) => (row.id === event.id ? merged : row)),
      })),
      refetch: sort === "unknown" ? "later" : false,
    };
  }

  if (event.kind === "create" && isNewestFirst(sortby) && data.pages.length > 0) {
    return {
      data: updatePage(data, 0, (page) =>
        adjustTotal({ ...page, data: [incoming, ...page.data] }, 0, 1),
      ),
      refetch: false,
    };
  }

  // A row entering the filter, a create under another sort, or a row on a
  // page that isn't loaded: only the server knows where it goes.
  return { data, refetch: "later" };
}

function updatePage(
  data: PagesData,
  index: number,
  update: (page: ListData) => ListData,
): PagesData {
  return { ...data, pages: data.pages.map((page, i) => (i === index ? update(page) : page)) };
}

// Every page carries the same total; only the first is adjusted, as the hooks
// read it from there.
function adjustTotal(page: ListData, pageIndex: number, delta: number): ListData {
  const total = page.pagination?.total;
  if (pageIndex !== 0 || typeof total !== "number") return page;
  return { ...page, pagination: { ...page.pagination, total: Math.max(0, total + delta) } };
}

function isNewestFirst(sortby: SortInput[] | undefined): boolean {
  const first = sortby?.[0];
  if (!first) return true;
  return (first.field === "integer_id" || first.field === "created_at") && first.order === "desc";
}

function sortChange(
  before: Row,
  after: Row,
  sortby: SortInput[] | undefined,
): "unchanged" | "changed" | "unknown" {
  let unknown = false;
  for (const { field } of sortby ?? []) {
    if (IMMUTABLE_SORT_FIELDS.has(field)) continue;
    const previous = readPath(before, field);
    const next = readPath(after, field);
    if (next === undefined) {
      unknown = true;
      continue;
    }
    if (JSON.stringify(previous) !== JSON.stringify(next)) return "changed";
  }
  return unknown ? "unknown" : "unchanged";
}

// Relations arrive as `{ data: … }`, so a dotted path unwraps them on the way.
function readPath(row: unknown, path: string): unknown {
  let value: unknown = row;
  for (const key of path.split(".")) {
    if (value && typeof value === "object" && "data" in value && !(key in value)) {
      value = (value as { data: unknown }).data;
    }
    if (!value || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

import { describe, it, expectTypeOf } from "vitest";
import type { PaginationData } from "@pylo/core";
import { createPyloHooks } from "../src/hooks.js";

type NoRelations = Record<never, never>;
interface MockSchema {
  contact: {
    fields: { id: string; name: string };
    relations: NoRelations;
    updateInput: Record<string, never>;
  };
  note: {
    fields: { id: string; body: string };
    relations: { contacts: { type: "hasMany"; entity: "contact" } };
    updateInput: Record<string, never>;
  };
  // A virtual entity, as codegen emits it: full shape, `virtual: true`, and no
  // create/update inputs because it has no mutation endpoints.
  me: {
    fields: { authenticaton_method: string };
    relations: { current_user: { type: "hasOne"; entity: "contact" } };
    virtual: true;
  };
}

const { usePyloList, usePyloInfiniteList, usePyloById, usePyloMe } =
  createPyloHooks<MockSchema>({});

describe("usePyloList select inference", () => {
  it("keeps a hasMany relation in the result type", () => {
    const { data } = usePyloList("note", {
      select: { id: true, contacts: { select: { name: true } } },
    });
    expectTypeOf(data).toEqualTypeOf<
      | Array<{ id: string; contacts: { data: Array<{ name: string }> } }>
      | undefined
    >();
  });

  it("keeps a hasMany relation when `pagination` is also selected", () => {
    const { data } = usePyloList("note", {
      select: {
        id: true,
        contacts: { select: { name: true, _pagination: { total: true } }, pagination: { per_page: 5 } },
      },
    });
    expectTypeOf(data![0]!.id).toEqualTypeOf<string>();
    expectTypeOf(data![0]!.contacts).toEqualTypeOf<
      { data: Array<{ name: string }> } & { pagination: { total: number } }
    >();
  });
});

describe("usePyloList pagination", () => {
  it("has no pagination without a pagination select", () => {
    const result = usePyloList("note", { select: { id: true }, pagination: { page: 2 } });
    expectTypeOf<"pagination" extends keyof typeof result ? true : false>().toEqualTypeOf<false>();
  });

  it("carries only the selected pagination fields", () => {
    const { pagination } = usePyloList("note", {
      select: { id: true, _pagination: { has_more_pages: true } },
      pagination: { page: 2 },
    });
    expectTypeOf(pagination).toEqualTypeOf<{ has_more_pages: boolean } | undefined>();
  });
});

describe("usePyloById select inference", () => {
  it("keeps a hasMany relation when `pagination` is also selected", () => {
    const { data } = usePyloById("note", "id", {
      select: {
        id: true,
        contacts: { select: { name: true, _pagination: { total: true } }, pagination: { per_page: 5 } },
      },
    });
    expectTypeOf(data!).not.toBeNever();
    expectTypeOf(data!.contacts).toEqualTypeOf<
      { data: Array<{ name: string }> } & { pagination: { total: number } }
    >();
  });
});

describe("usePyloInfiniteList pagination", () => {
  it("always carries the fields it pages with", () => {
    const result = usePyloInfiniteList("note", { select: { id: true } });
    expectTypeOf(result.data!.pages[0]!.pagination).toEqualTypeOf<
      Pick<PaginationData, "current_page" | "has_more_pages">
    >();
  });

  it("adds the selected pagination fields", () => {
    const result = usePyloInfiniteList("note", {
      select: { id: true, _pagination: { total: true } },
    });
    expectTypeOf(result.data!.pages[0]!.pagination.total).toEqualTypeOf<number>();
  });
});

describe("usePyloInfiniteList select inference", () => {
  it("keeps a hasMany relation in the result type", () => {
    const result = usePyloInfiniteList("note", {
      select: {
        id: true,
        contacts: { select: { name: true } },
      },
    });
    expectTypeOf(result.data!.data[0]!.contacts).toEqualTypeOf<{
      data: Array<{ name: string }>;
    }>();
  });
});

describe("hook strictness", () => {
  it("rejects unknown top-level keys", () => {
    // @ts-expect-error — `nope` is not a field on note
    usePyloList("note", { select: { id: true, nope: true } });
  });

  it("rejects unknown keys when the select is a variable", () => {
    const sel: { id: true; nope: true } = { id: true, nope: true };
    // @ts-expect-error — `nope` is not a field on note
    usePyloList("note", { select: sel });
  });

  it("rejects `true` for a relation", () => {
    // @ts-expect-error — relations require an explicit { select }
    usePyloList("note", { select: { contacts: true } });
  });
});

describe("usePyloMe", () => {
  it("types the result from the select, like usePyloById", () => {
    const { data } = usePyloMe({
      select: {
        authenticaton_method: true,
        current_user: { select: { name: true } },
      },
    });
    expectTypeOf(data).toEqualTypeOf<
      | {
          authenticaton_method: string;
          current_user: { data: { name: string } } | null;
        }
      | undefined
    >();
  });

  it("returns only the selected fields", () => {
    const { data } = usePyloMe({ select: { authenticaton_method: true } });
    expectTypeOf(data!).toEqualTypeOf<{ authenticaton_method: string }>();
  });

  it("requires a select", () => {
    // @ts-expect-error — `select` is required, exactly as on usePyloById
    usePyloMe({});
  });

  it("rejects unknown top-level keys", () => {
    // @ts-expect-error — `nope` is not a field on me
    usePyloMe({ select: { nope: true } });
  });
});

describe("virtual entities are not reachable through entity hooks", () => {
  it("rejects a virtual entity on usePyloList", () => {
    // @ts-expect-error — `me` has no list endpoint
    usePyloList("me", { select: { authenticaton_method: true } });
  });

  it("rejects a virtual entity on usePyloById", () => {
    // @ts-expect-error — `me` has no byId endpoint
    usePyloById("me", "id", { select: { authenticaton_method: true } });
  });
});

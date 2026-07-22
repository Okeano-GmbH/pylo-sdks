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
}

const { usePyloList, usePyloInfiniteList, usePyloById } =
  createPyloHooks<MockSchema>({});

describe("usePyloList select inference", () => {
  it("keeps a hasMany relation in the result type", () => {
    const { data } = usePyloList("note", {
      select: { id: true, contacts: { select: { name: true } } },
    });
    expectTypeOf(data).toEqualTypeOf<
      Array<{ id: string; contacts: { data: Array<{ name: string }> } }> | undefined
    >();
  });

  it("keeps a hasMany relation when `pagination` is also selected", () => {
    const { data } = usePyloList("note", {
      select: {
        id: true,
        contacts: { select: { name: true }, pagination: { per_page: 5 } },
      },
    });
    expectTypeOf(data![0]!.id).toEqualTypeOf<string>();
    expectTypeOf(data![0]!.contacts).toEqualTypeOf<
      { data: Array<{ name: string }> } & { pagination: PaginationData }
    >();
  });

});

describe("usePyloById select inference", () => {
  it("keeps a hasMany relation when `pagination` is also selected", () => {
    const { data } = usePyloById("note", "id", {
      select: {
        id: true,
        contacts: { select: { name: true }, pagination: { per_page: 5 } },
      },
    });
    expectTypeOf(data!).not.toBeNever();
    expectTypeOf(data!.contacts).toEqualTypeOf<
      { data: Array<{ name: string }> } & { pagination: PaginationData }
    >();
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

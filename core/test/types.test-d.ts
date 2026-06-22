import { describe, it, expectTypeOf } from "vitest";
import type { EntitySelect, EntityResult } from "../src/types.js";

// A hand-written schema mirroring the shape codegen emits for `PyloSchema`.
// Codegen emits `relations: {}` for entities with no relations; `keyof {}` is
// `never`, so model that with `Record<never, never>` (NOT `Record<string,
// never>`, whose key is `string`).
type NoRelations = Record<never, never>;
interface MockSchema {
  company: {
    fields: { id: string; name: string };
    relations: NoRelations;
    updateInput: Record<string, never>;
  };
  contact: {
    fields: { id: string; name: string; email: string };
    relations: { company: { type: "hasOne"; entity: "company" } };
    updateInput: Record<string, never>;
  };
  note: {
    fields: { id: string; body: string };
    relations: { contacts: { type: "hasMany"; entity: "contact" } };
    updateInput: Record<string, never>;
  };
}

type Select<E extends keyof MockSchema> = EntitySelect<MockSchema, E>;
type Result<E extends keyof MockSchema, S extends Select<E>> = EntityResult<
  MockSchema,
  E,
  S
>;

describe("EntitySelect", () => {
  it("accepts scalar fields as `true`", () => {
    const sel = { name: true, email: true } satisfies Select<"contact">;
    expectTypeOf(sel).toMatchObjectType<{ name: true; email: true }>();
  });

  it("accepts a hasOne relation as an explicit { select }", () => {
    const sel = {
      company: { select: { name: true } },
    } satisfies Select<"contact">;
    expectTypeOf(sel.company.select).toMatchObjectType<{ name: true }>();
  });

  it("rejects `true` for a relation (no auto-expand)", () => {
    // @ts-expect-error — relations require an explicit { select }
    const _sel = { company: true } satisfies Select<"contact">;
    void _sel;
  });

  it("rejects unknown fields", () => {
    // @ts-expect-error — `nope` is not a field on contact
    const _sel = { nope: true } satisfies Select<"contact">;
    void _sel;
  });
});

describe("EntityResult", () => {
  it("includes only the selected scalar fields", () => {
    const sel = { name: true } satisfies Select<"contact">;
    expectTypeOf<Result<"contact", typeof sel>>().toEqualTypeOf<{
      name: string;
    }>();
  });

  it("types a hasOne relation as { data } | null", () => {
    const sel = {
      name: true,
      company: { select: { name: true } },
    } satisfies Select<"contact">;
    expectTypeOf<Result<"contact", typeof sel>>().toEqualTypeOf<{
      name: string;
      company: { data: { name: string } } | null;
    }>();
  });

  it("omits pagination on a hasMany relation when not requested", () => {
    const sel = {
      contacts: { select: { id: true } },
    } satisfies Select<"note">;
    expectTypeOf<Result<"note", typeof sel>>().toEqualTypeOf<{
      contacts: { data: Array<{ id: string }> };
    }>();
  });

  it("includes pagination on a hasMany relation when requested", () => {
    const sel = {
      contacts: { select: { id: true }, pagination: { per_page: 5 } },
    } satisfies Select<"note">;
    expectTypeOf<
      Result<"note", typeof sel>["contacts"]
    >().toHaveProperty("pagination");
  });
});

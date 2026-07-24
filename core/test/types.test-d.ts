import { describe, it, expectTypeOf } from "vitest";
import type { EntitySelect, EntityResult, UpsertInput } from "../src/types.js";
import type { EntityClient, PyloClient } from "../src/client.js";
import type { FilterInput, PaginationData } from "../src/shared-types.js";

// A hand-written schema mirroring the shape codegen emits for `PyloSchema`.
// Codegen emits `relations: {}` for entities with no relations; `keyof {}` is
// `never`, so model that with `Record<never, never>` (NOT `Record<string,
// never>`, whose key is `string`).
type NoRelations = Record<never, never>;

// Mirrors the shape codegen emits for the mutation inputs: the scalar fields,
// the id/__search_value identifiers, and one `<relation><suffix>` key per
// relation suffix, each carrying the bare `<Target>Input` — `CompanyInput` for
// a hasOne `_set`, `ContactInput[]` for the hasMany suffixes, exactly as the
// GraphQL schema declares them. The bare input doubles as the update input.
type SearchValue = { field: string; value?: string };
interface CompanyInput {
  id?: string;
  __search_value?: SearchValue;
  name?: string;
}
interface ContactInput {
  id?: string;
  __search_value?: SearchValue;
  name?: string;
  email?: string;
  company_set?: CompanyInput;
}
interface NoteInput {
  id?: string;
  __search_value?: SearchValue;
  body?: string;
  contacts_set?: ContactInput[];
  contacts_connect?: ContactInput[];
  contacts_disconnect?: ContactInput[];
}

interface MockSchema {
  company: {
    fields: { id: string; name: string };
    relations: NoRelations;
    updateInput: CompanyInput;
  };
  contact: {
    fields: { id: string; name: string; email: string };
    relations: { company: { type: "hasOne"; entity: "company" } };
    updateInput: ContactInput;
  };
  note: {
    fields: { id: string; body: string };
    relations: { contacts: { type: "hasMany"; entity: "contact" } };
    updateInput: NoteInput;
  };
  // A virtual entity, as codegen emits it: full shape, `virtual: true`, and no
  // create/update inputs because it has no mutation endpoints.
  me: {
    fields: { authenticaton_method: string };
    relations: { current_user: { type: "hasOne"; entity: "contact" } };
    virtual: true;
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

// These go through the client signature, where `Sel` is inferred from the
// argument. `EntityResult` on its own was always correct — only inference lost
// relations that carried a `filter` or `pagination` key.
describe("EntityClient select inference", () => {
  const notes = {} as EntityClient<MockSchema, "note">;
  const contacts = {} as EntityClient<MockSchema, "contact">;

  it("keeps a hasMany relation in the result type", async () => {
    const { data } = await notes.list({
      select: { id: true, contacts: { select: { name: true } } },
    });
    expectTypeOf(data[0]!).toEqualTypeOf<{
      id: string;
      contacts: { data: Array<{ name: string }> };
    }>();
  });

  it("keeps a hasMany relation when `pagination` is also selected", async () => {
    const { data } = await notes.list({
      select: {
        id: true,
        contacts: { select: { name: true }, pagination: { per_page: 5 } },
      },
    });
    expectTypeOf(data[0]!.id).toEqualTypeOf<string>();
    expectTypeOf(data[0]!.contacts).toEqualTypeOf<
      { data: Array<{ name: string }> } & { pagination: PaginationData }
    >();
  });

  it("keeps a hasMany relation when `filter` is also selected", async () => {
    const { data } = await notes.list({
      select: {
        id: true,
        contacts: { select: { name: true }, filter: {} as FilterInput },
      },
    });
    expectTypeOf(data[0]!).toEqualTypeOf<{
      id: string;
      contacts: { data: Array<{ name: string }> };
    }>();
  });

  it("keeps relations on byId with `pagination` selected", async () => {
    const row = await notes.byId("id", {
      select: {
        id: true,
        contacts: { select: { name: true }, pagination: { per_page: 5 } },
      },
    });
    expectTypeOf(row).not.toBeNever();
    expectTypeOf(row!.id).toEqualTypeOf<string>();
    expectTypeOf(row!.contacts).toEqualTypeOf<
      { data: Array<{ name: string }> } & { pagination: PaginationData }
    >();
  });

  it("keeps a hasOne relation when its `filter` is also selected", async () => {
    const { data } = await contacts.list({
      select: {
        name: true,
        company: { select: { name: true }, filter: {} as FilterInput },
      },
    });
    expectTypeOf(data[0]!).toEqualTypeOf<{
      name: string;
      company: { data: { name: string } } | null;
    }>();
  });

  it("still rejects unknown keys in an inline select", async () => {
    // @ts-expect-error — `nope` is not a field on note
    await notes.list({ select: { id: true, nope: true } });
  });

  it("still rejects unknown keys when the select is a variable", async () => {
    const sel: { id: true; nope: true } = { id: true, nope: true };
    // @ts-expect-error — `nope` is not a field on note
    await notes.list({ select: sel });
  });

  it("still rejects unknown keys nested inside a relation select", async () => {
    // @ts-expect-error — `nope` is not a field on contact
    await notes.list({ select: { contacts: { select: { nope: true } } } });
  });

  it("still rejects `true` for a relation", async () => {
    // @ts-expect-error — relations require an explicit { select }
    await notes.list({ select: { contacts: true } });
  });
});

// Relation upserts. `MockSchema`'s update inputs mirror what codegen emits
// today — relation payloads are `Record<string, unknown>`, so nothing about the
// nested object is checked. These assertions describe what the GraphQL schema
// already promises (`company_set: CompanyInput`, `contacts_set:
// [ContactInput!]`) and fail until codegen emits it.
describe("upsert relation input", () => {
  const contacts = {} as EntityClient<MockSchema, "contact">;
  const notes = {} as EntityClient<MockSchema, "note">;

  it("accepts a typed nested payload on a hasOne _set", async () => {
    await contacts.upsert({ company_set: { name: "Acme" } });
  });

  it("rejects an unknown field inside a hasOne _set", async () => {
    // @ts-expect-error — `nmae` is not a field on company
    await contacts.upsert({ company_set: { nmae: "Acme" } });
  });

  // `Record<string, unknown>` would satisfy `toHaveProperty("name")` — the
  // property has to carry the target field's real type for autocomplete to
  // mean anything.
  it("types the nested payload with the target entity's field types", () => {
    expectTypeOf<
      NonNullable<UpsertInput<MockSchema, "contact">["company_set"]>["name"]
    >().toEqualTypeOf<string | undefined>();
  });

  it("takes an array on a hasMany _set/_connect/_disconnect", async () => {
    await notes.upsert({
      contacts_set: [{ email: "a@b.c" }],
      contacts_connect: [{ id: "ct_1" }],
      contacts_disconnect: [{ id: "ct_2" }],
    });
  });

  it("rejects an unknown field inside a hasMany payload", async () => {
    // @ts-expect-error — `emial` is not a field on contact
    await notes.upsert({ contacts_set: [{ emial: "a@b.c" }] });
  });

  it("still allows identifying a relation row by __search_value", async () => {
    await contacts.upsert({
      company_set: { __search_value: { field: "name", value: "Acme" } },
    });
  });

  // The schema's `<X>Input` types reference each other, so a nested payload can
  // keep upserting further relations all the way down.
  it("allows a relation upsert nested inside a relation upsert", async () => {
    await notes.upsert({
      contacts_set: [{ name: "Ada", company_set: { name: "Acme" } }],
    });
  });
});

describe("virtual entities", () => {
  const client = {} as PyloClient<MockSchema>;

  it("keeps real entities callable", () => {
    expectTypeOf(client.contact).toHaveProperty("list");
    expectTypeOf(client.note).toHaveProperty("byId");
  });

  it("drops the virtual entity from the client", () => {
    // @ts-expect-error — `me` is virtual; it has no list/byId/upsert endpoints
    expectTypeOf(client.me.list).toBeCallableWith({ select: { id: true } });
  });

  it("types me() from the select, like byId", async () => {
    const me = await client.me({
      select: {
        authenticaton_method: true,
        current_user: { select: { name: true } },
      },
    });
    expectTypeOf(me).toEqualTypeOf<{
      authenticaton_method: string;
      current_user: { data: { name: string } } | null;
    }>();
  });

  it("returns only the selected fields", async () => {
    const me = await client.me({ select: { authenticaton_method: true } });
    expectTypeOf(me).toEqualTypeOf<{ authenticaton_method: string }>();
  });

  it("rejects unknown keys in me's select", async () => {
    // @ts-expect-error — `nope` is not a field on me
    await client.me({ select: { nope: true } });
  });

  it("requires a select", async () => {
    // @ts-expect-error — `select` is required, exactly as on byId
    await client.me({});
  });

  it("accepts request options alongside select", async () => {
    await client.me({
      select: { authenticaton_method: true },
      headers: { "x-trace": "1" },
    });
  });
});

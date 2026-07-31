import { describe, it, expect } from "vitest";
import { analyzeEntities } from "../src/codegen/analyze.js";
import type { RawEntity } from "../src/codegen/fetch-schema.js";
import {
  generateEntitiesFile,
  generateIndexFile,
} from "../src/codegen/generate.js";

const field = (name: string, data_type = "TEXT", validation_string = "optional") => ({
  name,
  data_type,
  validation_string,
});

const contact: RawEntity = {
  name: "Contact",
  shortcode: "ct",
  is_system_entity: false,
  entity_fields: {
    data: [
      field("id", "TEXT", "required"),
      field("first_name"),
      field("body", "LONGTEXT"),
      field("created_at", "DATETIME"),
      field("updated_at", "DATETIME"),
    ],
  },
  entity_relations: { data: [] },
  entity_related: { data: [] },
} as unknown as RawEntity;

function updateInputOf(source: string): string {
  const out = generateIndexFile(analyzeEntities([contact]), source);
  const start = out.indexOf("export interface UpdateContactInput");
  return out.slice(start, out.indexOf("export interface", start + 1));
}

function createInputOf(source: string): string {
  const out = generateIndexFile(analyzeEntities([contact]), source);
  const start = out.indexOf("export interface CreateContactInput");
  return out.slice(start, out.indexOf("export interface", start + 1));
}

// The schema names this key `__replace_vars`, alongside the other underscored
// directive `__search_value`. It is declared `[String!]`; narrowing to a union
// of the entity's field names is a strict subtype, so it stays wire-compatible.
describe("generateIndexFile — __replace_vars", () => {
  const block = updateInputOf("@pylo/node");

  it("adds a typed __replace_vars field to the update input", () => {
    expect(block).toContain(
      "__replace_vars?: Array<'id' | 'first_name' | 'body'>",
    );
  });

  // Guards the rename: `replace_variables` is not a field the API accepts, so
  // it must not appear anywhere in the generated output.
  it("does not emit the old replace_variables name", () => {
    const out = generateIndexFile(analyzeEntities([contact]), "@pylo/node");
    expect(out).not.toContain("replace_variables");
  });

  // `id` is settable on an update input and its template variables are resolved,
  // so it belongs in the union — only the server-managed columns are excluded.
  it("excludes server-managed columns from the field-name union", () => {
    const union = block.slice(
      block.indexOf("__replace_vars"),
      block.indexOf(";", block.indexOf("__replace_vars")),
    );
    for (const sys of ["'integer_id'", "'created_at'", "'updated_at'"]) {
      expect(union).not.toContain(sys);
    }
    expect(union).toContain("'id'");
  });

  // The schema puts `__replace_vars` on the create inputs too.
  it("adds it to the create input as well", () => {
    expect(createInputOf("@pylo/node")).toContain("__replace_vars?: Array<");
  });

  // A create input has no `id` field, so no template can land in one.
  it("omits id from the create input's union", () => {
    const create = createInputOf("@pylo/node");
    const union = create.slice(
      create.indexOf("__replace_vars"),
      create.indexOf(";", create.indexOf("__replace_vars")),
    );
    expect(union).not.toContain("'id'");
    expect(union).toContain("'first_name'");
  });

  it("documents the field with a JSDoc comment", () => {
    expect(block).toContain("template variables");
    expect(block).toMatch(/\/\*\*[\s\S]*__replace_vars\?: Array</);
  });
});

describe("analyzeEntities — JSON fields", () => {
  // JSON is transferred as stringified JSON over the wire, so the generated
  // type must be a plain string, not a parsed object/array.
  const jsonEntity: RawEntity = {
    name: "Doc",
    shortcode: "dc",
    is_system_entity: false,
    entity_fields: {
      data: [
        field("metadata", "JSON"),
        field("config", "JSON", "required"),
      ],
    },
    entity_relations: { data: [] },
    entity_related: { data: [] },
  } as unknown as RawEntity;

  it("maps a required JSON field to string", () => {
    const [entity] = analyzeEntities([jsonEntity]);
    const config = entity.fields.find((f) => f.name === "config")!;
    expect(config.tsType).toBe("string");
    expect(config.nullable).toBe(false);
  });

  it("maps a nullable JSON field to string | null in generated output", () => {
    const out = generateIndexFile(analyzeEntities([jsonEntity]), "@pylo/node");
    expect(out).toContain("metadata: string | null;");
    expect(out).not.toContain("Record<string, unknown> | unknown[]");
  });
});

// Upserting a relation goes through the `<relation><suffix>` keys on the update
// input (`company_set`, `contacts_connect`, …). Typing their value as
// `Record<string, unknown>` compiles, but gives no autocomplete and no checking
// of the nested payload — so a typo like `frist_name` sails through.
//
// The generated types must match the GraphQL schema exactly. Introspecting a
// live endpoint shows one universal pattern across every relation, with no
// exceptions:
//
//   hasOne    <rel>_set: <Target>Input
//   hasMany   <rel>_set:        [<Target>Input!]
//             <rel>_connect:    [<Target>Input!]
//             <rel>_disconnect: [<Target>Input!]
//
// Note the payload is the *bare* `<Target>Input` — a type of its own, distinct
// from `Update<Target>Input` and `Create<Target>Input`. It carries `id` and
// `__search_value` (so a nested row can be identified) plus the target's own
// scalars and relation keys, which makes it recursive.
describe("generateIndexFile — relation mutation fields", () => {
  const contactToCompany = {
    type: "ManyToOne",
    field_name: "company",
    target_field_name: "contacts",
    target_entity: { data: { name: "Company" } },
    entity: { data: { name: "Contact" } },
  };

  const relContact: RawEntity = {
    ...contact,
    entity_relations: { data: [contactToCompany] },
  } as unknown as RawEntity;

  const company: RawEntity = {
    name: "Company",
    shortcode: "cp",
    is_system_entity: false,
    entity_fields: {
      data: [field("id", "TEXT", "required"), field("legal_name")],
    },
    entity_relations: { data: [] },
    // The same relation seen from the target side — codegen inverts it into a
    // hasMany `contacts` with _set/_connect/_disconnect.
    entity_related: { data: [contactToCompany] },
  } as unknown as RawEntity;

  const out = generateIndexFile(
    analyzeEntities([relContact, company]),
    "@pylo/node",
  );
  // Slice to the next declaration, not the next `}` — `__search_value` is an
  // inline object type, so it closes a brace of its own mid-interface.
  const block = (name: string) => {
    const start = out.indexOf(`export interface ${name} {`);
    expect(start).toBeGreaterThan(-1);
    const end = out.indexOf("export interface", start + 1);
    return out.slice(start, end === -1 ? undefined : end);
  };

  // `<Target>Input` is what every relation key points at, so codegen has to
  // emit it alongside the update inputs.
  it("emits a bare <Entity>Input per entity", () => {
    expect(out).toContain("export interface ContactInput {");
    expect(out).toContain("export interface CompanyInput {");
  });

  it("gives <Entity>Input the identifier keys and the entity's scalars", () => {
    const contactInput = block("ContactInput");
    expect(contactInput).toContain("id?: string;");
    expect(contactInput).toContain("__search_value?:");
    expect(contactInput).toContain("first_name?: string | null;");
  });

  it("types a hasOne _set with the bare target input", () => {
    expect(block("UpdateContactInput")).toContain("company_set?: CompanyInput;");
  });

  it("gives a hasOne relation no _connect/_disconnect", () => {
    const updateContact = block("UpdateContactInput");
    expect(updateContact).not.toContain("company_connect");
    expect(updateContact).not.toContain("company_disconnect");
  });

  it("types hasMany suffixes as an array of the bare target input", () => {
    const updateCompany = block("UpdateCompanyInput");
    expect(updateCompany).toContain("contacts_set?: ContactInput[];");
    expect(updateCompany).toContain("contacts_connect?: ContactInput[];");
    expect(updateCompany).toContain("contacts_disconnect?: ContactInput[];");
  });

  // The SDK itself only upserts, but the backend has `create<Entity>` mutations
  // that projects call directly with these types, so they get the same
  // treatment.
  it("types relation keys on the create input the same way", () => {
    expect(block("CreateContactInput")).toContain("company_set?: CompanyInput;");
    expect(block("CreateCompanyInput")).toContain(
      "contacts_set?: ContactInput[];",
    );
  });

  // The nested payload can itself upsert further relations — the schema's
  // `<X>Input` types reference each other, so the generated ones must too.
  it("makes <Entity>Input recursive through its own relation keys", () => {
    expect(block("ContactInput")).toContain("company_set?: CompanyInput;");
    expect(block("CompanyInput")).toContain("contacts_set?: ContactInput[];");
  });

  it("leaves no untyped Record payloads on relation keys", () => {
    expect(out).not.toContain("Record<string, unknown>");
  });
});

// Which attach/detach suffixes a hasMany relation gets. Derived by correlating
// every list relation in a live schema against the introspected SDL: the pair
// is `_connect`/`_disconnect`, except between two Pylo *system* entities, where
// it is `_add`/`_remove`. 207 relations, no exceptions. A hasOne relation gets
// neither — only `_set`, since a single slot has nothing to attach.
describe("analyzeEntities — attach/detach suffixes", () => {
  const rel = (from: string, to: string, type = "OneToMany") => ({
    type,
    field_name: `${to.toLowerCase()}s`,
    target_field_name: `${from.toLowerCase()}s`,
    entity: { data: { name: from } },
    target_entity: { data: { name: to } },
  });

  const entity = (
    name: string,
    is_system_entity: boolean,
    relations: unknown[] = [],
  ) =>
    ({
      name,
      shortcode: name.slice(0, 2).toLowerCase(),
      is_system_entity,
      entity_fields: { data: [field("id", "TEXT", "required")] },
      entity_relations: { data: relations },
      entity_related: { data: [] },
    }) as unknown as RawEntity;

  const suffixesOf = (entities: RawEntity[], from: string, to: string) => {
    const analyzed = analyzeEntities(entities);
    const owner = analyzed.find((e) => e.pascalName === from)!;
    return owner.relations.find((r) => r.targetEntityPascalName === to)!.suffixes;
  };

  it("uses _add/_remove when both endpoints are system entities", () => {
    const entities = [
      entity("PyloCustomer", true, [rel("PyloCustomer", "PyloUser")]),
      entity("PyloUser", true),
    ];
    expect(suffixesOf(entities, "PyloCustomer", "PyloUser")).toEqual([
      "_set",
      "_add",
      "_remove",
    ]);
  });

  it("uses _connect/_disconnect when the target is a business entity", () => {
    const entities = [
      entity("PyloUser", true, [rel("PyloUser", "Comment")]),
      entity("Comment", false),
    ];
    expect(suffixesOf(entities, "PyloUser", "Comment")).toEqual([
      "_set",
      "_connect",
      "_disconnect",
    ]);
  });

  it("uses _connect/_disconnect when the owner is a business entity", () => {
    const entities = [
      entity("RecyclingCompany", false, [rel("RecyclingCompany", "PyloUser")]),
      entity("PyloUser", true),
    ];
    expect(suffixesOf(entities, "RecyclingCompany", "PyloUser")).toEqual([
      "_set",
      "_connect",
      "_disconnect",
    ]);
  });

  it("applies the same rule to a reverse relation", () => {
    const entities = [
      entity("PyloUser", true),
      {
        ...entity("PyloAro", true),
        entity_related: { data: [rel("PyloUser", "PyloAro", "ManyToMany")] },
      } as unknown as RawEntity,
    ];
    const analyzed = analyzeEntities(entities);
    const aro = analyzed.find((e) => e.pascalName === "PyloAro")!;
    expect(aro.relations[0]!.suffixes).toEqual(["_set", "_add", "_remove"]);
  });

  it("gives a hasOne relation only _set, whichever entities it joins", () => {
    const entities = [
      entity("PyloApiKey", true, [rel("PyloApiKey", "PyloUser", "ManyToOne")]),
      entity("PyloUser", true),
    ];
    expect(suffixesOf(entities, "PyloApiKey", "PyloUser")).toEqual(["_set"]);
  });

  it("treats an unresolvable target as non-system", () => {
    const entities = [entity("PyloUser", true, [rel("PyloUser", "Absent")])];
    expect(suffixesOf(entities, "PyloUser", "Absent")).toEqual([
      "_set",
      "_connect",
      "_disconnect",
    ]);
  });
});

describe("generateIndexFile — schema registration", () => {
  it("registers the schema for @pylo/node and @pylo/nextjs", () => {
    for (const source of ["@pylo/node", "@pylo/nextjs"]) {
      const out = generateIndexFile(analyzeEntities([contact]), source);
      expect(out).toContain(`declare module '${source}'`);
      expect(out).toContain("interface PyloRegister");
    }
  });

  it("does not register a schema for @pylo/core", () => {
    const out = generateIndexFile(analyzeEntities([contact]), "@pylo/core");
    expect(out).not.toContain("declare module");
  });
});

// `is_readable: false` means the backend's schema generator leaves the field off
// the output type (GraphQLService: `if ($isOutputType && !$modelField->is_readable) continue;`),
// so selecting it fails server-side. System entities report it for their
// foreign-key columns; custom entity fields are always readable.
describe("analyzeEntities — is_readable", () => {
  const mixed: RawEntity = {
    name: "PyloUser",
    shortcode: "pu",
    is_system_entity: true,
    entity_fields: {
      data: [
        { ...field("id", "TEXT", "required"), is_readable: true },
        { ...field("email"), is_readable: true },
        { ...field("pylo_customer_id"), is_readable: false },
        { ...field("pylo_app_id"), is_readable: false },
      ],
    },
    entity_relations: { data: [] },
    entity_related: { data: [] },
  } as unknown as RawEntity;

  it("drops fields the server will not return", () => {
    const [entity] = analyzeEntities([mixed]);
    expect(entity!.fields.map((f) => f.name)).toEqual(["id", "email"]);
  });

  it("keeps them out of the generated types entirely", () => {
    const out = generateIndexFile(analyzeEntities([mixed]), "@pylo/node");
    expect(out).not.toContain("pylo_customer_id");
    expect(out).not.toContain("pylo_app_id");
    expect(out).toContain("email: string | null;");
  });

  // Instances that predate the field report nothing; only an explicit `false`
  // excludes a field, so an older backend keeps its current output.
  it("keeps fields when the flag is absent", () => {
    const legacy = {
      ...mixed,
      entity_fields: { data: [field("id", "TEXT", "required"), field("email")] },
    } as unknown as RawEntity;
    expect(analyzeEntities([legacy])[0]!.fields).toHaveLength(2);
  });

  // An entity whose every field is unreadable still has to produce valid output
  // rather than an empty block.
  it("falls back to the empty-block stand-in when nothing is readable", () => {
    const allHidden = {
      ...mixed,
      name: "Opaque",
      entity_fields: {
        data: [{ ...field("secret_id"), is_readable: false }],
      },
    } as unknown as RawEntity;
    const out = generateIndexFile(analyzeEntities([allHidden]), "@pylo/node");
    expect(out).toContain("fields: Record<never, never>;");
    expect(out).not.toContain("secret_id");
  });
});

// `client.me()` types against the schema key `me` — `Me<S>` in client.ts is
// `"me" extends EntityName<S> ? (…) : never`, so any other key makes the method
// uncallable. The backend names the entity `PyloMe`, which the default
// first-character-lowercase rule would turn into `pyloMe`.
describe("analyzeEntities — PyloMe key", () => {
  const pyloMe: RawEntity = {
    name: "PyloMe",
    shortcode: "pm",
    is_system_entity: true,
    is_virtual: true,
    entity_fields: {
      data: [field("id", "TEXT", "required"), field("authenticaton_method")],
    },
    entity_relations: { data: [] },
    entity_related: { data: [] },
  } as unknown as RawEntity;

  it("keys PyloMe as `me` so client.me() resolves", () => {
    const [entity] = analyzeEntities([pyloMe]);
    expect(entity!.key).toBe("me");
  });

  it("keeps the real name for the emitted type names", () => {
    const [entity] = analyzeEntities([pyloMe]);
    expect(entity!.pascalName).toBe("PyloMe");
    const out = generateIndexFile([entity!], "@pylo/node");
    expect(out).toContain("export interface PyloMeInput {");
    expect(out).toContain("  me: {");
  });

  it("leaves other Pylo-prefixed entities alone", () => {
    const pyloUser = { ...pyloMe, name: "PyloUser" } as RawEntity;
    expect(analyzeEntities([pyloUser])[0]!.key).toBe("pyloUser");
  });

  // A relation pointing at it has to name the same key, or the schema's
  // `relations` entry would reference an entity that isn't there.
  it("uses the override for relation targets too", () => {
    const owner = {
      name: "Comment",
      shortcode: "cm",
      is_system_entity: false,
      entity_fields: { data: [field("id", "TEXT", "required")] },
      entity_relations: {
        data: [
          {
            type: "ManyToOne",
            field_name: "author",
            target_field_name: "comments",
            target_entity: { data: { name: "PyloMe" } },
            entity: { data: { name: "Comment" } },
          },
        ],
      },
      entity_related: { data: [] },
    } as unknown as RawEntity;
    const [comment] = analyzeEntities([owner, pyloMe]);
    expect(comment!.relations[0]!.targetEntityKey).toBe("me");
  });
});

// A virtual entity carrying neither fields nor relations describes nothing —
// PyloEvent, whose rows live in ClickHouse. Everything generated for it would
// be an empty `{}`, and the client drops the key regardless.
describe("analyzeEntities — empty virtual entities", () => {
  const pyloEvent: RawEntity = {
    name: "PyloEvent",
    shortcode: "PEVT",
    is_system_entity: true,
    is_virtual: true,
    entity_fields: { data: [] },
    entity_relations: { data: [] },
    entity_related: { data: [] },
  } as unknown as RawEntity;

  it("drops it entirely", () => {
    const analyzed = analyzeEntities([contact, pyloEvent]);
    expect(analyzed.map((e) => e.pascalName)).toEqual(["Contact"]);
  });

  it("keeps a virtual entity that has a shape", () => {
    const pyloMe = {
      ...pyloEvent,
      name: "PyloMe",
      entity_fields: { data: [field("id", "TEXT", "required")] },
    } as unknown as RawEntity;
    expect(analyzeEntities([pyloMe]).map((e) => e.key)).toEqual(["me"]);
  });

  // Without the flag there is nothing to key the decision on, so the entity is
  // emitted — the generators fall back to a non-empty stand-in instead.
  it("keeps an empty entity that is not flagged virtual", () => {
    const unflagged = { ...pyloEvent, is_virtual: undefined } as RawEntity;
    expect(analyzeEntities([unflagged])).toHaveLength(1);
  });
});

// `{}` in TypeScript means "any non-nullish value", not "an object with no
// properties" — hence the no-empty-object-type lint. `Record<never, never>`
// carries the intended meaning: `keyof` stays `never`, so `select` still
// rejects unknown keys.
describe("generate — entities with nothing in a block", () => {
  const bare: RawEntity = {
    name: "Bare",
    shortcode: "br",
    is_system_entity: false,
    entity_fields: { data: [] },
    entity_relations: { data: [] },
    entity_related: { data: [] },
  } as unknown as RawEntity;

  it("never writes an empty fields or relations block", () => {
    const out = generateIndexFile(analyzeEntities([contact, bare]), "@pylo/node");
    expect(out).not.toMatch(/(fields|relations): \{\s*\};/);
    expect(out).toContain("fields: Record<never, never>;");
    expect(out).toContain("relations: Record<never, never>;");
  });

  // Contact has fields but no relations — the common case, 13 entities in a
  // real schema.
  it("uses it for the relations block of an ordinary entity", () => {
    const out = generateIndexFile(analyzeEntities([contact]), "@pylo/node");
    expect(out).toContain("relations: Record<never, never>;");
    expect(out).toContain("first_name: string | null;");
  });

  it("never writes an empty interface into entities.ts", () => {
    const out = generateEntitiesFile(analyzeEntities([bare]), "@pylo/node");
    expect(out).not.toContain("export interface Bare {}");
    expect(out).toContain("export type Bare = Record<never, never>;");
  });

  it("still writes a real interface when there is something to describe", () => {
    const out = generateEntitiesFile(analyzeEntities([contact]), "@pylo/node");
    expect(out).toContain("export interface Contact {");
  });
});

describe("generateIndexFile — virtual entities", () => {
  const me: RawEntity = {
    name: "Me",
    shortcode: "me",
    is_system_entity: true,
    is_virtual: true,
    entity_fields: {
      data: [field("id", "TEXT", "required"), field("authenticaton_method")],
    },
    entity_relations: { data: [] },
    entity_related: { data: [] },
  } as unknown as RawEntity;

  const out = () => generateIndexFile(analyzeEntities([contact, me]), "@pylo/node");

  it("keeps the virtual entity's shape in PyloSchema", () => {
    expect(out()).toContain("me: {");
    expect(out()).toContain("authenticaton_method");
  });

  it("marks it virtual so the client can drop the key", () => {
    expect(out()).toContain("virtual: true;");
  });

  it("gives it no create/update inputs", () => {
    expect(out()).not.toContain("CreateMeInput");
    expect(out()).not.toContain("UpdateMeInput");
  });

  // It still gets a bare `MeInput` — a relation can target a virtual entity.
  it("still emits its bare input type", () => {
    expect(out()).toContain("export interface MeInput {");
  });

  it("leaves real entities callable and mutable", () => {
    const generated = out();
    expect(generated).toContain("createInput: CreateContactInput;");
    expect(generated).toContain("updateInput: UpdateContactInput;");
    expect(generated).toContain("export interface UpdateContactInput");
  });

  it("does not mark real entities virtual", () => {
    const contactBlock = out().slice(
      out().indexOf("contact: {"),
      out().indexOf("me: {"),
    );
    expect(contactBlock).not.toContain("virtual");
  });
});

describe("generateIndexFile — system entities", () => {
  // A system entity that isn't virtual: `PyloUser` has the same
  // list/byId/upsert/delete endpoints as any custom entity.
  const pyloUser: RawEntity = {
    name: "PyloUser",
    shortcode: "pu",
    is_system_entity: true,
    is_virtual: false,
    entity_fields: {
      data: [field("id", "TEXT", "required"), field("email")],
    },
    entity_relations: { data: [] },
    entity_related: { data: [] },
  } as unknown as RawEntity;

  const out = () => generateIndexFile(analyzeEntities([contact, pyloUser]), "@pylo/node");

  // The entity's entry in `PyloSchema`, which ends at the first dedented `};`.
  const block = () => {
    const generated = out();
    const start = generated.indexOf("pyloUser: {");
    return generated.slice(start, generated.indexOf("\n  };", start));
  };

  it("does not mark it virtual", () => {
    expect(block()).not.toContain("virtual: true;");
  });

  it("marks it system, so aggregates keep `integer_id`", () => {
    expect(block()).toContain("system: true;");
  });

  it("gives it create/update inputs, so it can be listed and upserted", () => {
    expect(out()).toContain("export interface CreatePyloUserInput {");
    expect(out()).toContain("export interface UpdatePyloUserInput {");
    expect(block()).toContain("createInput: CreatePyloUserInput;");
    expect(block()).toContain("updateInput: UpdatePyloUserInput;");
  });
});

// A field with variants is read through a `data` envelope: the query builder
// selects it as `<field>_variants { data { value variant is_default } }`, so
// the payload is `{ data: [...] }` — the same wrapper relations use — not a bare
// list, and each row carries the `is_default` fallback flag. Writes are the
// other way round: the input takes the list itself, without `is_default`.
describe("generateIndexFile — variant fields", () => {
  const variantContact: RawEntity = {
    ...contact,
    entity_fields: {
      data: [
        field("id", "TEXT", "required"),
        {
          ...field("title"),
          variant_entity_field: { data: { name: "Language" } },
        },
      ],
    },
  } as unknown as RawEntity;

  const out = generateIndexFile(analyzeEntities([variantContact]), "@pylo/node");

  it("types the read field as a data envelope around the variant list", () => {
    expect(out).toContain(
      "title_variants: { data: { variant: string; value: string; is_default: boolean }[] } | null;",
    );
  });

  it("keeps the write field a bare list", () => {
    expect(out).toContain(
      "title_variants?: { variant: string; value: string }[];",
    );
  });

  it("emits the same envelope in the entities file", () => {
    const entitiesFile = generateEntitiesFile(
      analyzeEntities([variantContact]),
      "@pylo/node",
    );
    expect(entitiesFile).toContain(
      "title_variants: { data: { variant: string; value: string; is_default: boolean }[] } | null;",
    );
  });
});

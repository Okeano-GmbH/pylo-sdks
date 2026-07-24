import { describe, it, expect } from "vitest";
import { analyzeEntities } from "../src/codegen/analyze.js";
import type { RawEntity } from "../src/codegen/fetch-schema.js";
import { generateIndexFile } from "../src/codegen/generate.js";

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

describe("generateIndexFile — virtual entities", () => {
  const me: RawEntity = {
    name: "Me",
    shortcode: "me",
    is_system_entity: true,
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

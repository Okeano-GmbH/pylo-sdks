import type { AnalyzedEntity, AnalyzedField } from "./analyze.js";

const VARIANT_TYPE = "{ variant: string; value: string }";

// Packages that expose an augmentable `PyloRegister` — when codegen targets one
// of these (via `importSource`), the generated index registers the schema so
// the `pylo` client and the `PyloSelect` / `PyloResult` helpers are typed with
// no manual `declare module` step. `@pylo/core` has no register, so it's
// omitted.
const REGISTERABLE_SOURCES = new Set(["@pylo/node", "@pylo/nextjs"]);

function fieldTypeString(field: AnalyzedField): string {
  if (field.nullable) {
    return `${field.tsType} | null`;
  }
  return field.tsType;
}

function indent(text: string, level: number): string {
  const spaces = "  ".repeat(level);
  return text
    .split("\n")
    .map((line) => (line.trim() ? spaces + line : line))
    .join("\n");
}

function getVariantFieldNames(entity: AnalyzedEntity): string[] {
  return entity.fields
    .filter((f) => f.variantFieldName !== null)
    .map((f) => f.variantFieldName!);
}

// None writeable fields to replace variables. `id` is deliberately absent — it
// is settable on an update input and its template variables do get resolved.
const NON_WRITABLE_FIELDS = new Set(["integer_id", "created_at", "updated_at"]);

// The `__replace_vars` field: a list of the field names whose template
// variables the server should resolve during the upsert. The schema declares it
// as `[String!]`; narrowing to a union of the entity's own field names is a
// strict subtype, so it stays wire-compatible while giving autocomplete.
//
// `id` is only offered where it can actually be set — the create input has no
// `id` field, so a template could never land in one.
//
// An entity whose content is all relations has no field name to narrow to; the
// key still exists on the schema's input, so it falls back to the declared
// `[String!]` rather than being dropped.
function generateReplaceVarsField(
  entity: AnalyzedEntity,
  options: { includeId: boolean },
): string {
  const fieldNames = entity.fields
    .map((f) => f.name)
    .filter((name) => !NON_WRITABLE_FIELDS.has(name))
    .filter((name) => options.includeId || name !== "id");

  const union =
    fieldNames.length > 0
      ? fieldNames.map((name) => `'${name}'`).join(" | ")
      : "string";
  return [
    "/**",
    " * Field names whose template variables (e.g. `${replace_uuid.myNewEntity}`) the server",
    " * should resolve to their concrete values during this upsert.",
    " */",
    `__replace_vars?: Array<${union}>;`,
  ].join("\n");
}

function generateEntityFieldsType(entity: AnalyzedEntity): string {
  const lines = entity.fields.map((f) => `${f.name}: ${fieldTypeString(f)};`);
  for (const variantName of getVariantFieldNames(entity)) {
    lines.push(`${variantName}: ${VARIANT_TYPE}[] | null;`);
  }
  return lines.join("\n");
}

function generateEntityRelationsType(entity: AnalyzedEntity): string {
  if (entity.relations.length === 0) return "";
  const lines = entity.relations.map(
    (r) =>
      `${r.fieldName}: { type: '${r.type}'; entity: '${r.targetEntityKey}' };`,
  );
  return lines.join("\n");
}

const SEARCH_VALUE_FIELD =
  "__search_value?: { field: string; value?: string; not_found_behavior?: 'create' | 'ignore' | 'error'; search_in_all_field_variants?: boolean; multiple_results_allowed?: boolean; multiple_results_use_latest?: boolean };";

// The writable scalar columns — `id` and the server-managed ones are handled
// separately (or not at all).
function generateScalarFields(entity: AnalyzedEntity): string[] {
  const lines: string[] = [];

  for (const field of entity.fields) {
    if (field.name === "id" || field.name === "integer_id") continue;
    if (field.name === "created_at" || field.name === "updated_at") continue;
    lines.push(`${field.name}?: ${fieldTypeString(field)};`);
  }

  for (const variantName of getVariantFieldNames(entity)) {
    lines.push(`${variantName}?: ${VARIANT_TYPE}[];`);
  }

  return lines;
}

// The `<relation><suffix>` keys that upsert a relation. Their value is the
// target entity's own input type, exactly as the GraphQL schema declares it:
//
//   hasOne    <rel>_set: <Target>Input
//   hasMany   <rel>_set / _connect / _disconnect: [<Target>Input!]
//
// Note this is the *bare* `<Target>Input`, not `Update<Target>Input` — a
// distinct type that carries the identifiers plus the target's own fields and
// relations, so nested upserts type-check all the way down.
function generateRelationFields(entity: AnalyzedEntity): string[] {
  const lines: string[] = [];

  for (const rel of entity.relations) {
    const target = `${rel.targetEntityPascalName}Input`;
    const valueType = rel.type === "hasMany" ? `${target}[]` : target;
    for (const suffix of rel.suffixes) {
      lines.push(`${rel.fieldName}${suffix}?: ${valueType};`);
    }
  }

  return lines;
}

// The bare `<Entity>Input` — what every relation key points at. It identifies a
// row (`id` / `__search_value`) and can create or update it, so it carries the
// same body as the update input. Emitted for *every* entity, including virtual
// ones: they have no mutation endpoints of their own, but relations still
// target them, so the type has to exist.
function generateEntityInputType(entity: AnalyzedEntity): string {
  const lines: string[] = ["id?: string;", SEARCH_VALUE_FIELD];

  lines.push(generateReplaceVarsField(entity, { includeId: true }));

  lines.push(...generateScalarFields(entity), ...generateRelationFields(entity));

  return lines.join("\n");
}

// The SDK's only mutation is `upsert`, so nothing here consumes the create
// input — but the backend does expose `create<Entity>` mutations and projects
// call them directly through their generated types, so it stays emitted.
function generateCreateInputType(entity: AnalyzedEntity): string {
  const lines: string[] = [
    generateReplaceVarsField(entity, { includeId: false }),
  ];

  lines.push(...generateScalarFields(entity), ...generateRelationFields(entity));

  return lines.join("\n");
}

function generateUpdateInputType(entity: AnalyzedEntity): string {
  return generateEntityInputType(entity);
}

function collectEnumTypes(
  entities: AnalyzedEntity[],
): Array<{ typeName: string; values: string[] }> {
  const seen = new Map<string, string[]>();
  for (const entity of entities) {
    for (const field of entity.fields) {
      if (field.enum && !seen.has(field.enum.typeName)) {
        seen.set(field.enum.typeName, field.enum.values);
      }
    }
  }
  return Array.from(seen, ([typeName, values]) => ({ typeName, values }));
}

export function generateIndexFile(
  entities: AnalyzedEntity[],
  importSource: string,
): string {
  const lines: string[] = [];

  lines.push(
    "// Auto-generated by @pylo/core codegen — DO NOT EDIT",
    "",
    "export type {",
    "  FilterInput,",
    "  PaginationData,",
    "  PaginationInput,",
    "  QueryInput,",
    "  QueryInputCondition,",
    "  QueryOperator,",
    "  SortInput,",
    "  SortOrder,",
    "  SearchValueInput,",
    `} from '${importSource}';`,
    "",
  );

  // Enum type aliases
  const enumTypes = collectEnumTypes(entities);
  if (enumTypes.length > 0) {
    for (const { typeName, values } of enumTypes) {
      const union = values.map((v) => `'${v}'`).join(" | ");
      lines.push(`export type ${typeName} = ${union};`);
    }
    lines.push("");
  }

  // The bare `<Entity>Input` is the payload of every relation upsert key, so it
  // exists for virtual entities too — a relation can point at one even though it
  // has no mutation endpoints of its own.
  for (const entity of entities) {
    lines.push(`export interface ${entity.pascalName}Input {`);
    lines.push(indent(generateEntityInputType(entity), 1));
    lines.push("}", "");
  }

  // Generate create/update input types for each entity. Virtual entities have
  // no mutation endpoints, so they get no create/update inputs.
  for (const entity of entities) {
    if (entity.isVirtual) continue;

    lines.push(`export interface Create${entity.pascalName}Input {`);
    lines.push(indent(generateCreateInputType(entity), 1));
    lines.push("}", "");

    lines.push(`export interface Update${entity.pascalName}Input {`);
    lines.push(indent(generateUpdateInputType(entity), 1));
    lines.push("}", "");
  }

  // Generate PyloSchema
  lines.push("export interface PyloSchema {");
  for (const entity of entities) {
    lines.push(`  ${entity.key}: {`);
    lines.push("    fields: {");
    lines.push(indent(generateEntityFieldsType(entity), 3));
    lines.push("    };");

    const relType = generateEntityRelationsType(entity);
    lines.push("    relations: {");
    if (relType) {
      lines.push(indent(relType, 3));
    }
    lines.push("    };");

    // `system: true` marks a Pylo-internal entity. It says nothing about which
    // endpoints exist — system entities list and upsert like any other — but
    // their fields live in native columns, which changes what can be aggregated.
    if (entity.isSystem) {
      lines.push("    system: true;");
    }

    // `virtual: true` marks an entity that `entityList` reports but that has no
    // list/byId/upsert/delete endpoints. Its shape stays in the schema so
    // `select` still types against it, but `PyloClient` drops the key so it
    // cannot be called. `me` is served by the dedicated `client.me()` instead.
    if (entity.isVirtual) {
      lines.push("    virtual: true;");
    } else {
      lines.push(`    createInput: Create${entity.pascalName}Input;`);
      lines.push(`    updateInput: Update${entity.pascalName}Input;`);
    }
    lines.push("  };");
  }
  lines.push("}", "");

  // Register the schema so the typed client and the PyloSelect/PyloResult
  // helpers pick it up automatically (no hand-written `declare module`).
  if (REGISTERABLE_SOURCES.has(importSource)) {
    lines.push(
      `declare module '${importSource}' {`,
      "  interface PyloRegister {",
      "    schema: PyloSchema;",
      "  }",
      "}",
      "",
    );
  }

  return lines.join("\n");
}

export function generateEntitiesFile(
  entities: AnalyzedEntity[],
  importSource: string,
): string {
  const lines: string[] = [];

  lines.push(
    "// Auto-generated by @pylo/core codegen — DO NOT EDIT",
    "",
    `import type { PaginationData } from '${importSource}';`,
  );

  const enumTypes = collectEnumTypes(entities);
  if (enumTypes.length > 0) {
    const names = enumTypes.map((e) => e.typeName).join(", ");
    lines.push(`import type { ${names} } from './index.js';`);
  }

  lines.push("");

  for (const entity of entities) {
    lines.push(`export interface ${entity.pascalName} {`);
    for (const field of entity.fields) {
      lines.push(`  ${field.name}: ${fieldTypeString(field)};`);
    }
    for (const variantName of getVariantFieldNames(entity)) {
      lines.push(`  ${variantName}: ${VARIANT_TYPE}[] | null;`);
    }
    for (const rel of entity.relations) {
      if (rel.type === "hasOne") {
        lines.push(
          `  ${rel.fieldName}?: { data: ${rel.targetEntityPascalName} } | null;`,
        );
      } else {
        lines.push(
          `  ${rel.fieldName}?: { data: ${rel.targetEntityPascalName}[]; pagination: PaginationData };`,
        );
      }
    }
    lines.push("}", "");
  }

  return lines.join("\n");
}

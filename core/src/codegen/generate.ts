import { ENTITY_CAPABILITY_NAMES } from "./analyze.js";
import type { AnalyzedEntity, AnalyzedField } from "./analyze.js";

const VARIANT_TYPE = "{ variant: string; value: string }";

// Reads come back enveloped, and carry one field writes don't: the query builder
// selects a variant field as `field { data { value variant is_default } }`, so
// the payload is a `data` wrapper — the same shape relations use — around rows
// that also flag the fallback variant. Writes take the bare list.
const VARIANT_RESULT_ITEM = "{ variant: string; value: string; is_default: boolean }";
const VARIANT_RESULT_TYPE = `{ data: ${VARIANT_RESULT_ITEM}[] } | null`;

// Packages that expose an augmentable `PyloRegister` — when codegen targets one
// of these (via `importSource`), the generated index registers the schema so
// the `pylo` client and the `PyloSelect` / `PyloResult` helpers are typed with
// no manual `declare module` step. `@pylo/core` has no register, so it's
// omitted.
const REGISTERABLE_SOURCES = new Set(["@pylo/node", "@pylo/nextjs"]);

// `{}` means "any non-nullish value" and trips no-empty-object-type. This keeps
// `keyof` at `never`, so `select` still rejects unknown keys — unlike
// `{ [key: string]: never }`, which widens it to `string`.
const EMPTY_BLOCK = "Record<never, never>";

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

// Output types carry the readable fields, input types the writable ones. The
// two sets overlap for almost every field, but the backend gates them
// separately and rejects a query or payload that crosses the line.
function readableFields(entity: AnalyzedEntity): AnalyzedField[] {
  return entity.fields.filter((f) => f.readable);
}

function writableFields(entity: AnalyzedEntity): AnalyzedField[] {
  return entity.fields.filter((f) => f.writable);
}

function getVariantFieldNames(fields: AnalyzedField[]): string[] {
  return fields
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
  const fieldNames = writableFields(entity)
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
  const fields = readableFields(entity);
  const lines = fields.map((f) => `${f.name}: ${fieldTypeString(f)};`);
  for (const variantName of getVariantFieldNames(fields)) {
    lines.push(`${variantName}: ${VARIANT_RESULT_TYPE};`);
  }
  return lines.join("\n");
}

// The entity's endpoints as a string union — `'list' | 'byId' | …`, or `never`
// where there are none. A union keeps the schema entry to one line and lets the
// client pick methods with `'list' extends Capabilities<S, E>`.
function generateCapabilityUnion(entity: AnalyzedEntity): string {
  const granted = ENTITY_CAPABILITY_NAMES.filter(
    (name) => entity.capabilities[name],
  );
  if (granted.length === 0) return "never";
  return granted.map((name) => `'${name}'`).join(" | ");
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
  const fields = writableFields(entity);

  for (const field of fields) {
    if (field.name === "id" || field.name === "integer_id") continue;
    if (field.name === "created_at" || field.name === "updated_at") continue;
    lines.push(`${field.name}?: ${fieldTypeString(field)};`);
  }

  for (const variantName of getVariantFieldNames(fields)) {
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

  // Only for the mutations the entity actually has. `PyloUsageReport` is
  // listable but never written, so a `CreatePyloUsageReportInput` would describe
  // a payload with nowhere to send it.
  for (const entity of entities) {
    if (entity.capabilities.create) {
      lines.push(`export interface Create${entity.pascalName}Input {`);
      lines.push(indent(generateCreateInputType(entity), 1));
      lines.push("}", "");
    }

    if (entity.capabilities.update) {
      lines.push(`export interface Update${entity.pascalName}Input {`);
      lines.push(indent(generateUpdateInputType(entity), 1));
      lines.push("}", "");
    }
  }

  // Generate PyloSchema
  lines.push("export interface PyloSchema {");
  for (const entity of entities) {
    lines.push(`  ${entity.key}: {`);

    const fieldsType = generateEntityFieldsType(entity);
    if (fieldsType) {
      lines.push("    fields: {");
      lines.push(indent(fieldsType, 3));
      lines.push("    };");
    } else {
      lines.push(`    fields: ${EMPTY_BLOCK};`);
    }

    const relType = generateEntityRelationsType(entity);
    if (relType) {
      lines.push("    relations: {");
      lines.push(indent(relType, 3));
      lines.push("    };");
    } else {
      lines.push(`    relations: ${EMPTY_BLOCK};`);
    }

    // `system: true` marks a Pylo-internal entity. It says nothing about which
    // endpoints exist — system entities list and upsert like any other — but
    // their fields live in native columns, which changes what can be aggregated.
    if (entity.isSystem) {
      lines.push("    system: true;");
    }

    if (entity.capabilities.create) {
      lines.push(`    createInput: Create${entity.pascalName}Input;`);
    }
    if (entity.capabilities.update) {
      lines.push(`    updateInput: Update${entity.pascalName}Input;`);
    }

    // `virtual: true` still marks an entity with no endpoints at all, because
    // `client.me()` and the `integer_id` exclusion key off it. What each entity
    // can be *called* with now comes from `capabilities` instead.
    if (entity.isVirtual) {
      lines.push("    virtual: true;");
    }
    lines.push(`    capabilities: ${generateCapabilityUnion(entity)};`);
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
    const fields = readableFields(entity);

    // `interface X {}` would mean "any non-nullish value"; the alias does not.
    if (fields.length === 0 && entity.relations.length === 0) {
      lines.push(`export type ${entity.pascalName} = ${EMPTY_BLOCK};`, "");
      continue;
    }

    lines.push(`export interface ${entity.pascalName} {`);
    for (const field of fields) {
      lines.push(`  ${field.name}: ${fieldTypeString(field)};`);
    }
    for (const variantName of getVariantFieldNames(fields)) {
      lines.push(`  ${variantName}: ${VARIANT_RESULT_TYPE};`);
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

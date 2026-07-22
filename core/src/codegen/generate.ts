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

// The `replace_variables` field for an update input: a typed list of the
// entity's writable field names whose template variables the server should
// resolve during the upsert. Returns the commented TS lines, or `null` when the
// entity has no writable fields.
function generateReplaceVariablesField(entity: AnalyzedEntity): string | null {
  const fieldNames = entity.fields
    .map((f) => f.name)
    .filter((name) => !NON_WRITABLE_FIELDS.has(name));
  if (fieldNames.length === 0) return null;

  const union = fieldNames.map((name) => `'${name}'`).join(" | ");
  return [
    "/**",
    " * Field names whose template variables (e.g. `${replace_uuid.myNewEntity}`) the server",
    " * should resolve to their concrete values during this upsert.",
    " */",
    `replace_variables?: Array<${union}>;`,
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

function generateCreateInputType(entity: AnalyzedEntity): string {
  const lines: string[] = [];

  for (const field of entity.fields) {
    if (field.name === "id" || field.name === "integer_id") continue;
    if (field.name === "created_at" || field.name === "updated_at") continue;
    lines.push(`${field.name}?: ${fieldTypeString(field)};`);
  }

  for (const variantName of getVariantFieldNames(entity)) {
    lines.push(`${variantName}?: ${VARIANT_TYPE}[];`);
  }

  for (const rel of entity.relations) {
    for (const suffix of rel.suffixes) {
      const valueType =
        rel.type === "hasMany"
          ? "Record<string, unknown>[]"
          : "Record<string, unknown>";
      lines.push(`${rel.fieldName}${suffix}?: ${valueType};`);
    }
  }

  return lines.join("\n");
}

function generateUpdateInputType(entity: AnalyzedEntity): string {
  const lines: string[] = [];

  lines.push("id?: string;");
  lines.push(
    "__search_value?: { field: string; value?: string; not_found_behavior?: 'create' | 'ignore' | 'error'; search_in_all_field_variants?: boolean; multiple_results_allowed?: boolean; multiple_results_use_latest?: boolean };",
  );

  const replaceVariables = generateReplaceVariablesField(entity);
  if (replaceVariables) {
    lines.push(replaceVariables);
  }

  for (const field of entity.fields) {
    if (field.name === "id" || field.name === "integer_id") continue;
    if (field.name === "created_at" || field.name === "updated_at") continue;
    lines.push(`${field.name}?: ${fieldTypeString(field)};`);
  }

  for (const variantName of getVariantFieldNames(entity)) {
    lines.push(`${variantName}?: ${VARIANT_TYPE}[];`);
  }

  for (const rel of entity.relations) {
    for (const suffix of rel.suffixes) {
      const valueType =
        rel.type === "hasMany"
          ? "Record<string, unknown>[]"
          : "Record<string, unknown>";
      lines.push(`${rel.fieldName}${suffix}?: ${valueType};`);
    }
  }

  return lines.join("\n");
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

  // Generate create/update input types for each entity
  for (const entity of entities) {
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

    lines.push(`    createInput: Create${entity.pascalName}Input;`);
    lines.push(`    updateInput: Update${entity.pascalName}Input;`);
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

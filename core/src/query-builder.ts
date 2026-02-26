import type { SchemaMetadata, EntityMetadata } from "./shared-types.js";

interface BuildResult {
  query: string;
  variables: Record<string, unknown>;
}

interface SelectObject {
  [key: string]:
    | true
    | {
        select?: SelectObject;
        filter?: unknown;
        pagination?: unknown;
      };
}

// Runtime option types — accept `unknown` since type safety is at the SDK layer
interface ListOptionsInput {
  select?: unknown;
  filter?: unknown;
  pagination?: unknown;
}

interface ByIdOptionsInput {
  select?: unknown;
}

const PAGINATION_FIELDS = `pagination {
    total
    current_page
    per_page
    last_page
    has_more_pages
  }`;

function buildSelectionSet(
  select: SelectObject | undefined,
  entityMeta: EntityMetadata,
  schemaMetadata: SchemaMetadata,
  variables: Record<string, unknown>,
  variableTypes: Map<string, string>,
  prefix: string,
): string {
  const fields: string[] = [];

  const variantFieldNames = entityMeta.variantFieldNames ?? [];

  if (!select) {
    // No select → all scalar fields + variant fields
    fields.push(...entityMeta.scalarFieldNames);
    for (const vf of variantFieldNames) {
      fields.push(`${vf} { data { value variant } }`);
    }
    return fields.join("\n    ");
  }

  for (const [key, value] of Object.entries(select)) {
    // Check if it's a scalar field
    if (entityMeta.scalarFieldNames.includes(key)) {
      if (value === true) {
        fields.push(key);
      }
      continue;
    }

    // Check if it's a variant field
    if (variantFieldNames.includes(key)) {
      if (value === true) {
        fields.push(`${key} { data { value variant } }`);
      }
      continue;
    }

    // Check if it's a relation
    const relation = entityMeta.relations[key];
    if (!relation) {
      if (schemaMetadata.unknownFieldBehavior === "ignore") continue;
      const validFields = [...entityMeta.scalarFieldNames, ...variantFieldNames].join(", ");
      const validRelations = Object.keys(entityMeta.relations).join(", ");
      throw new Error(
        `Unknown field "${key}" on entity "${entityMeta.pascalName}". Valid fields: ${validFields}. Valid relations: ${validRelations}`,
      );
    }

    const targetMeta = schemaMetadata.entities[relation.entity];
    if (!targetMeta) continue;

    const isHasMany = relation.type === "hasMany";

    if (value === true) {
      // Fetch all scalar fields + variant fields of target
      const targetFieldParts = [...targetMeta.scalarFieldNames];
      for (const vf of targetMeta.variantFieldNames ?? []) {
        targetFieldParts.push(`${vf} { data { value variant } }`);
      }
      const targetFields = targetFieldParts.join(" ");
      if (isHasMany) {
        fields.push(`${key} { data { ${targetFields} } ${PAGINATION_FIELDS} }`);
      } else {
        fields.push(`${key} { data { ${targetFields} } }`);
      }
    } else if (typeof value === "object" && value !== null) {
      const argParts: string[] = [];

      // Handle filter argument
      if (value.filter !== undefined) {
        const varName = `${prefix}${key}_filter`;
        variables[varName] = value.filter;
        variableTypes.set(varName, "FilterInput");
        argParts.push(`filter: $${varName}`);
      }

      // Handle pagination argument
      if (isHasMany && value.pagination !== undefined) {
        const varName = `${prefix}${key}_pagination`;
        variables[varName] = value.pagination;
        variableTypes.set(varName, "PaginationInput");
        argParts.push(`pagination: $${varName}`);
      }

      const args = argParts.length > 0 ? `(${argParts.join(", ")})` : "";

      // Build nested selection
      const nestedSelection = buildSelectionSet(
        value.select,
        targetMeta,
        schemaMetadata,
        variables,
        variableTypes,
        `${prefix}${key}_`,
      );

      if (isHasMany) {
        fields.push(
          `${key}${args} { data { ${nestedSelection} } ${PAGINATION_FIELDS} }`,
        );
      } else {
        fields.push(`${key}${args} { data { ${nestedSelection} } }`);
      }
    }
  }

  return fields.join("\n    ");
}

export function buildListQuery(
  entityKey: string,
  options: ListOptionsInput | undefined,
  schemaMetadata: SchemaMetadata,
): BuildResult {
  const entityMeta = schemaMetadata.entities[entityKey];
  if (!entityMeta) {
    throw new Error(`Unknown entity: ${entityKey}`);
  }

  const variables: Record<string, unknown> = {};
  const variableTypes = new Map<string, string>();

  // Top-level filter and pagination
  if (options?.filter !== undefined) {
    variables["filter"] = options.filter;
    variableTypes.set("filter", "FilterInput");
  }
  if (options?.pagination !== undefined) {
    variables["pagination"] = options.pagination;
    variableTypes.set("pagination", "PaginationInput");
  }

  const selectionSet = buildSelectionSet(
    options?.select as SelectObject | undefined,
    entityMeta,
    schemaMetadata,
    variables,
    variableTypes,
    "r_",
  );

  // Build variable declarations
  const varDecls = Array.from(variableTypes.entries())
    .map(([name, type]) => `$${name}: ${type}`)
    .join(", ");

  const varSection = varDecls ? `(${varDecls})` : "";

  // Build argument list for the query field
  const argParts: string[] = [];
  if (variableTypes.has("filter")) {
    argParts.push("filter: $filter");
  }
  if (variableTypes.has("pagination")) {
    argParts.push("pagination: $pagination");
  }
  const argSection = argParts.length > 0 ? `(${argParts.join(", ")})` : "";

  const queryName = `${entityKey}List`;

  const query = `query ${capitalize(entityKey)}List${varSection} {
  ${queryName}${argSection} {
    data {
      ${selectionSet}
    }
    ${PAGINATION_FIELDS}
  }
}`;

  return { query, variables };
}

export function buildByIdQuery(
  entityKey: string,
  id: string,
  options: ByIdOptionsInput | undefined,
  schemaMetadata: SchemaMetadata,
): BuildResult {
  const entityMeta = schemaMetadata.entities[entityKey];
  if (!entityMeta) {
    throw new Error(`Unknown entity: ${entityKey}`);
  }

  const variables: Record<string, unknown> = { id };
  const variableTypes = new Map<string, string>([["id", "ID!"]]);

  const selectionSet = buildSelectionSet(
    options?.select as SelectObject | undefined,
    entityMeta,
    schemaMetadata,
    variables,
    variableTypes,
    "r_",
  );

  const varDecls = Array.from(variableTypes.entries())
    .map(([name, type]) => `$${name}: ${type}`)
    .join(", ");

  const query = `query ${capitalize(entityKey)}ById(${varDecls}) {
  ${entityKey}ById(id: $id) {
    data {
      ${selectionSet}
    }
  }
}`;

  return { query, variables };
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

import type { RawEntity, RawEntityField, RawEntityRelation } from "./fetch-schema.js";

export interface AnalyzedField {
  name: string;
  tsType: string;
  nullable: boolean;
  variantFieldName: string | null;
  enum: { typeName: string; values: string[] } | null;
}

export interface AnalyzedRelation {
  fieldName: string;
  type: "hasOne" | "hasMany";
  targetEntityKey: string;
  targetEntityPascalName: string;
  suffixes: string[];
}

export interface AnalyzedEntity {
  key: string;
  pascalName: string;
  shortcode: string;
  isSystem: boolean;
  fields: AnalyzedField[];
  relations: AnalyzedRelation[];
}

const DATA_TYPE_MAP: Record<string, string> = {
  TEXT: "string",
  LONGTEXT: "string",
  RICHTEXT: "string",
  INT: "number",
  FLOAT: "number",
  JSON: "Record<string, unknown> | unknown[]",
  DATE: "string",
  DATETIME: "string",
  TIME: "string",
  BOOLEAN: "boolean",
};

function mapDataType(dataType: string): string {
  return DATA_TYPE_MAP[dataType] ?? "string";
}

function isNullable(field: RawEntityField): boolean {
  return field.validation_string !== "required";
}

function classifyRelation(
  relationType: string,
): "hasOne" | "hasMany" {
  if (relationType === "ManyToOne" || relationType === "OneToOne") {
    return "hasOne";
  }
  return "hasMany";
}

// Inverse: from the target entity's perspective, the relation direction flips.
// ManyToOne (many A → one B) seen from B = hasMany (B has many A's)
// OneToMany (one A → many B) seen from B = hasOne (B belongs to one A)
// OneToOne stays hasOne, ManyToMany stays hasMany.
function classifyReverseRelation(
  relationType: string,
): "hasOne" | "hasMany" {
  if (relationType === "OneToMany" || relationType === "OneToOne") {
    return "hasOne";
  }
  return "hasMany";
}

function getMutationSuffixes(relType: "hasOne" | "hasMany"): string[] {
  if (relType === "hasOne") {
    return ["_set"];
  }
  return ["_set", "_connect", "_disconnect"];
}

function toEntityKey(pascalName: string): string {
  return pascalName.charAt(0).toLowerCase() + pascalName.slice(1);
}

function toPascalCase(snake: string): string {
  return snake
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function analyzeField(
  field: RawEntityField,
  entityPascalName: string,
): AnalyzedField {
  const hasVariants = field.variant_entity_field?.data?.name != null;
  const enumValues = field.entity_field_enum_values?.data ?? [];

  if (enumValues.length > 0) {
    const typeName = `${entityPascalName}${toPascalCase(field.name)}`;
    const values = enumValues.map((v) => v.value);
    return {
      name: field.name,
      tsType: typeName,
      nullable: isNullable(field),
      variantFieldName: hasVariants ? `${field.name}_variants` : null,
      enum: { typeName, values },
    };
  }

  return {
    name: field.name,
    tsType: mapDataType(field.data_type),
    nullable: isNullable(field),
    variantFieldName: hasVariants ? `${field.name}_variants` : null,
    enum: null,
  };
}

function analyzeRelation(relation: RawEntityRelation): AnalyzedRelation | null {
  const targetName = relation.target_entity?.data?.name;
  if (!targetName || !relation.field_name) return null;

  const relType = classifyRelation(relation.type);

  return {
    fieldName: relation.field_name,
    type: relType,
    targetEntityKey: toEntityKey(targetName),
    targetEntityPascalName: targetName,
    suffixes: getMutationSuffixes(relType),
  };
}

// For entity_related: the relation is defined on the *source* entity,
// so we read it from the target's perspective:
//   fieldName = target_field_name (the field on THIS entity)
//   target = entity.data.name (the source entity we're relating to)
//   type = inverted
function analyzeReverseRelation(relation: RawEntityRelation): AnalyzedRelation | null {
  const sourceName = relation.entity?.data?.name;
  if (!sourceName || !relation.target_field_name) return null;

  const relType = classifyReverseRelation(relation.type);

  return {
    fieldName: relation.target_field_name,
    type: relType,
    targetEntityKey: toEntityKey(sourceName),
    targetEntityPascalName: sourceName,
    suffixes: getMutationSuffixes(relType),
  };
}

export function analyzeEntities(rawEntities: RawEntity[]): AnalyzedEntity[] {
  return rawEntities.map((entity) => {
    const fields = (entity.entity_fields?.data ?? []).map((f) =>
      analyzeField(f, entity.name),
    );

    const forwardRelations = (entity.entity_relations?.data ?? [])
      .map(analyzeRelation)
      .filter((r): r is AnalyzedRelation => r !== null);

    const reverseRelations = (entity.entity_related?.data ?? [])
      .map(analyzeReverseRelation)
      .filter((r): r is AnalyzedRelation => r !== null);

    // Deduplicate by fieldName — forward relations take precedence
    const seen = new Set(forwardRelations.map((r) => r.fieldName));
    const deduped = reverseRelations.filter((r) => !seen.has(r.fieldName));

    return {
      key: toEntityKey(entity.name),
      pascalName: entity.name,
      shortcode: entity.shortcode,
      isSystem: entity.is_system_entity,
      fields,
      relations: [...forwardRelations, ...deduped],
    };
  });
}

import type { RawEntity, RawEntityField, RawEntityRelation } from "./fetch-schema.js";

export interface AnalyzedField {
  name: string;
  tsType: string;
  nullable: boolean;
  // Whether the field is on the generated output type / input types. Selecting
  // an unreadable field or writing an unwritable one is a server-side error, so
  // each emission site filters on the one that applies to it.
  readable: boolean;
  writable: boolean;
  variantFieldName: string | null;
  enum: { typeName: string; values: string[] } | null;
}

// Generic endpoints an entity exposes. Every entity can be aggregated, so that
// is not part of the set.
export interface EntityCapabilities {
  list: boolean;
  byId: boolean;
  create: boolean;
  update: boolean;
  bulkUpsert: boolean;
  delete: boolean;
}

export const ENTITY_CAPABILITY_NAMES = [
  "list",
  "byId",
  "create",
  "update",
  "bulkUpsert",
  "delete",
] as const satisfies ReadonlyArray<keyof EntityCapabilities>;

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
  // No list/byId/upsert/delete endpoints — `PyloMe` and `PyloEvent`, which are
  // read through `me` / `pyloEventList` instead.
  isVirtual: boolean;
  capabilities: EntityCapabilities;
  fields: AnalyzedField[];
  relations: AnalyzedRelation[];
}

const DATA_TYPE_MAP: Record<string, string> = {
  TEXT: "string",
  LONGTEXT: "string",
  RICHTEXT: "string",
  INT: "number",
  FLOAT: "number",
  JSON: "string",
  DATE: "string",
  DATETIME: "string",
  TIME: "string",
  BOOLEAN: "boolean",
};

function mapDataType(dataType: string): string {
  return DATA_TYPE_MAP[dataType] ?? "string";
}

// Validation strings are `;`-separated rules, each optionally carrying
// `:params` — "required", but also "required;unique" or "min:0;required".
function hasValidationRule(validationString: string | null, rule: string): boolean {
  if (!validationString) return false;
  return validationString
    .split(";")
    .some((part) => part.split(":", 1)[0]?.trim() === rule);
}

function isNullable(field: RawEntityField): boolean {
  return !hasValidationRule(field.validation_string, "required");
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

// A hasOne relation exposes only `_set` — there is nothing to attach or detach
// when the slot holds a single row.
//
// A hasMany relation also exposes an attach/detach pair. The schema names it
// `_connect`/`_disconnect`, except when the relation runs between two Pylo
// *system* entities, where it is `_add`/`_remove`. Both endpoints have to be
// system entities: `PyloUser.pylo_aros` (system → system) is `_add`/`_remove`,
// while `PyloUser.comments` (system → business) and `RecyclingCompany.pylo_users`
// (business → system) are both `_connect`/`_disconnect`.
function getMutationSuffixes(
  relType: "hasOne" | "hasMany",
  bothSystem: boolean,
): string[] {
  if (relType === "hasOne") {
    return ["_set"];
  }
  return bothSystem
    ? ["_set", "_add", "_remove"]
    : ["_set", "_connect", "_disconnect"];
}

// `Me<S>` keys off the literal string `me` and resolves to `never` for anything
// else, so `PyloMe` has to land on that key or `client.me()` is uncallable.
const ENTITY_KEY_OVERRIDES: Record<string, string> = {
  PyloMe: "me",
};

function toEntityKey(pascalName: string): string {
  const override = ENTITY_KEY_OVERRIDES[pascalName];
  if (override !== undefined) return override;
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
  const access = {
    readable: field.is_readable !== false,
    writable: field.is_writeable !== false,
  };

  if (enumValues.length > 0) {
    const typeName = `${entityPascalName}${toPascalCase(field.name)}`;
    const values = enumValues.map((v) => v.value);
    return {
      name: field.name,
      tsType: typeName,
      nullable: isNullable(field),
      ...access,
      variantFieldName: hasVariants ? `${field.name}_variants` : null,
      enum: { typeName, values },
    };
  }

  return {
    name: field.name,
    tsType: mapDataType(field.data_type),
    nullable: isNullable(field),
    ...access,
    variantFieldName: hasVariants ? `${field.name}_variants` : null,
    enum: null,
  };
}

function analyzeRelation(
  relation: RawEntityRelation,
  isSystem: SystemEntityLookup,
): AnalyzedRelation | null {
  const targetName = relation.target_entity?.data?.name;
  if (!targetName || !relation.field_name) return null;

  const relType = classifyRelation(relation.type);

  return {
    fieldName: relation.field_name,
    type: relType,
    targetEntityKey: toEntityKey(targetName),
    targetEntityPascalName: targetName,
    suffixes: getMutationSuffixes(relType, isSystem.owner && isSystem.of(targetName)),
  };
}

// For entity_related: the relation is defined on the *source* entity,
// so we read it from the target's perspective:
//   fieldName = target_field_name (the field on THIS entity)
//   target = entity.data.name (the source entity we're relating to)
//   type = inverted
function analyzeReverseRelation(
  relation: RawEntityRelation,
  isSystem: SystemEntityLookup,
): AnalyzedRelation | null {
  const sourceName = relation.entity?.data?.name;
  if (!sourceName || !relation.target_field_name) return null;

  const relType = classifyReverseRelation(relation.type);

  return {
    fieldName: relation.target_field_name,
    type: relType,
    targetEntityKey: toEntityKey(sourceName),
    targetEntityPascalName: sourceName,
    suffixes: getMutationSuffixes(relType, isSystem.owner && isSystem.of(sourceName)),
  };
}

// Whether the entity owning a relation is a system entity, plus a lookup for
// the same flag on the relation's other endpoint — both are needed to pick the
// attach/detach suffix pair.
interface SystemEntityLookup {
  owner: boolean;
  of: (entityName: string) => boolean;
}

// Nothing to describe and no endpoints to reach it by — every type generated
// for it would be an empty `{}`. Today: PyloEvent, read through `client.events`.
function hasNothingToEmit(entity: AnalyzedEntity): boolean {
  return (
    entity.isVirtual &&
    entity.fields.filter((f) => f.readable).length === 0 &&
    entity.relations.length === 0
  );
}

// Virtual entities are the one case decided without asking the backend: they
// have no generic endpoints by definition.
function analyzeCapabilities(entity: RawEntity): EntityCapabilities {
  if (entity.is_virtual) {
    return {
      list: false,
      byId: false,
      create: false,
      update: false,
      bulkUpsert: false,
      delete: false,
    };
  }

  return {
    list: entity.can_list,
    byId: entity.can_get_by_id,
    create: entity.can_create,
    update: entity.can_update,
    bulkUpsert: entity.can_bulk_update,
    delete: entity.can_delete,
  };
}

export function analyzeEntities(rawEntities: RawEntity[]): AnalyzedEntity[] {
  const systemByName = new Map(
    rawEntities.map((e) => [e.name, e.is_system_entity]),
  );
  // An unknown target is treated as non-system, which yields the
  // `_connect`/`_disconnect` pair used everywhere outside the Pylo internals.
  const isSystemEntity = (name: string) => systemByName.get(name) ?? false;

  const analyzed = rawEntities.map((entity) => {
    // Kept whole, readable or not: the output and input types filter on
    // different flags, so the split happens where each one is emitted.
    const fields = (entity.entity_fields?.data ?? []).map((f) =>
      analyzeField(f, entity.name),
    );

    const isSystem: SystemEntityLookup = {
      owner: entity.is_system_entity,
      of: isSystemEntity,
    };

    const forwardRelations = (entity.entity_relations?.data ?? [])
      .map((r) => analyzeRelation(r, isSystem))
      .filter((r): r is AnalyzedRelation => r !== null);

    const reverseRelations = (entity.entity_related?.data ?? [])
      .map((r) => analyzeReverseRelation(r, isSystem))
      .filter((r): r is AnalyzedRelation => r !== null);

    // Deduplicate by fieldName — forward relations take precedence
    const seen = new Set(forwardRelations.map((r) => r.fieldName));
    const deduped = reverseRelations.filter((r) => !seen.has(r.fieldName));

    return {
      key: toEntityKey(entity.name),
      pascalName: entity.name,
      shortcode: entity.shortcode,
      isSystem: entity.is_system_entity,
      isVirtual: entity.is_virtual,
      capabilities: analyzeCapabilities(entity),
      fields,
      relations: [...forwardRelations, ...deduped],
    };
  });

  return analyzed.filter((entity) => !hasNothingToEmit(entity));
}

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
  // No list/byId/upsert/delete endpoints — `PyloMe` and `PyloEvent`, which are
  // read through `me` / `pyloEventList` instead.
  isVirtual: boolean;
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

// The authenticated principal is reached through `client.me()`, which types
// against the schema key `me` (see `Me<S>` in client.ts — it resolves to `never`
// for any other key, making the method uncallable). The backend names the entity
// `PyloMe`, so the key is remapped here. `pascalName` keeps the real name, so
// `PyloMeInput` and the `entities.ts` interface are unaffected, and relations
// pointing at it resolve to the same key.
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

// A virtual entity with no fields and no relations has nothing to describe:
// every generated type for it would be an empty `{}`, and the client drops the
// key anyway. Today that is PyloEvent, whose rows live in ClickHouse and are
// read through `client.events` rather than the entity endpoints. Virtual
// entities that do carry a shape (PyloMe) are kept — `client.me()` types
// against one.
function hasNothingToEmit(entity: AnalyzedEntity): boolean {
  return (
    entity.isVirtual &&
    entity.fields.length === 0 &&
    entity.relations.length === 0
  );
}

export function analyzeEntities(rawEntities: RawEntity[]): AnalyzedEntity[] {
  const systemByName = new Map(
    rawEntities.map((e) => [e.name, e.is_system_entity]),
  );
  // An unknown target is treated as non-system, which yields the
  // `_connect`/`_disconnect` pair used everywhere outside the Pylo internals.
  const isSystemEntity = (name: string) => systemByName.get(name) ?? false;

  const analyzed = rawEntities.map((entity) => {
    // `is_readable: false` means the field is not on the generated output type,
    // so selecting it is a server-side error. System entities report it for
    // their foreign-key columns (`pylo_customer_id`, `parent_id`, …) and for
    // any entity whose table is not its queryable shape (PyloMe). Custom
    // entities report every field readable.
    const fields = (entity.entity_fields?.data ?? [])
      .filter((f) => f.is_readable !== false)
      .map((f) => analyzeField(f, entity.name));

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
      fields,
      relations: [...forwardRelations, ...deduped],
    };
  });

  return analyzed.filter((entity) => !hasNothingToEmit(entity));
}

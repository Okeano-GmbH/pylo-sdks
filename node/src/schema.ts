// Re-exports the browser-safe schema toolkit (@pylo/core/schema) from @pylo/node.
export {
  ENTITY_LIST_QUERY,
  fetchSchemaWith,
  analyzeEntities,
  generateIndexFile,
  generateEntitiesFile,
} from "@pylo/core/schema";
export type {
  SchemaFetcher,
  RawEntity,
  RawEntityField,
  RawEntityRelation,
  EntityListResponse,
  AnalyzedEntity,
  AnalyzedField,
  AnalyzedRelation,
} from "@pylo/core/schema";

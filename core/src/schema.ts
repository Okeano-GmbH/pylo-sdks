// Browser-safe schema toolkit: the introspect → analyze → generate building
// blocks with NO Node-only dependencies (no jiti / node:fs / process.cwd).
// Safe to import from a browser bundle (admin editor) or a server runtime
// (flow worker). The full fs-writing orchestrator lives in `./codegen`.
export {
  ENTITY_LIST_QUERY,
  fetchSchemaWith,
} from "./codegen/fetch-schema.js";
export type {
  SchemaFetcher,
  RawEntity,
  RawEntityField,
  RawEntityRelation,
  EntityListResponse,
} from "./codegen/fetch-schema.js";
export {
  DOCUMENT_TEMPLATE_LIST_QUERY,
  fetchDocumentTemplatesWith,
} from "./codegen/fetch-templates.js";
export type {
  RawDocumentTemplate,
  DocumentTemplateListResponse,
} from "./codegen/fetch-templates.js";
export { analyzeEntities } from "./codegen/analyze.js";
export { analyzeDocumentTemplates } from "./codegen/analyze-templates.js";
export type {
  AnalyzedDocumentTemplate,
  TemplateInput,
  TemplateListItem,
  TemplateObjectField,
  TemplateValueType,
} from "./codegen/analyze-templates.js";
export type {
  AnalyzedEntity,
  AnalyzedField,
  AnalyzedRelation,
} from "./codegen/analyze.js";
export {
  generateIndexFile,
  generateEntitiesFile,
  generateDocumentTemplatesType,
  generateDocumentRefTypes,
} from "./codegen/generate.js";

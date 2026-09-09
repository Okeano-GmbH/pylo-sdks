import type { RawDocumentTemplate } from "./fetch-templates.js";

// The input schema the template editor writes into `input_schema`. Kept
// structurally identical to the editor's own `TemplateInput`, since that is the
// producer of every row codegen reads here.
export type TemplateValueType =
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "datetime";

export interface TemplateObjectField {
  name: string;
  type: TemplateValueType;
}

/** What each element of a list input is: a record of an entity, or a custom object. */
export type TemplateListItem =
  | { kind: "entity"; entity: string }
  | { kind: "object"; fields: TemplateObjectField[] };

/**
 * `hasDefault` is what the editor's `default` becomes here. The value itself is
 * not carried: the renderer substitutes it server-side, so all codegen needs to
 * know is that omitting the input is allowed.
 */
export type TemplateInput =
  | {
      name: string;
      kind: "entity";
      entity: string;
      required: boolean;
      hasDefault?: boolean;
    }
  | {
      name: string;
      kind: "value";
      type: TemplateValueType;
      required: boolean;
      hasDefault?: boolean;
    }
  | {
      name: string;
      kind: "list";
      item: TemplateListItem;
      required: boolean;
      hasDefault?: boolean;
    };

export interface AnalyzedDocumentTemplate {
  key: string;
  name: string;
  description: string | null;
  inputs: TemplateInput[];
}

const VALUE_TYPES = new Set<string>([
  "text",
  "number",
  "boolean",
  "date",
  "datetime",
]);

function parseInputSchema(
  raw: RawDocumentTemplate["input_schema"],
): unknown {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toObjectFields(value: unknown): TemplateObjectField[] {
  if (!Array.isArray(value)) return [];
  const fields: TemplateObjectField[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const { name, type } = entry;
    if (typeof name !== "string" || name === "") continue;
    fields.push({
      name,
      type: (typeof type === "string" && VALUE_TYPES.has(type)
        ? type
        : "text") as TemplateValueType,
    });
  }
  return fields;
}

function toListItem(value: unknown): TemplateListItem | null {
  if (!isRecord(value)) return null;
  if (value["kind"] === "entity") {
    const entity = value["entity"];
    if (typeof entity !== "string" || entity === "") return null;
    return { kind: "entity", entity };
  }
  if (value["kind"] === "object") {
    return { kind: "object", fields: toObjectFields(value["fields"]) };
  }
  return null;
}

// An input the editor could not have produced (a hand-edited row, or one from a
// newer editor than this SDK) is dropped rather than guessed at: a wrong type
// would reject a call the server accepts.
function toTemplateInput(value: unknown): TemplateInput | null {
  if (!isRecord(value)) return null;
  const name = value["name"];
  if (typeof name !== "string" || name === "") return null;
  const required = value["required"] === true;
  // `false` and `0` are defaults; an empty string is the editor's "not set".
  const fallback = value["default"];
  const withDefault =
    fallback !== undefined && fallback !== null && fallback !== ""
      ? { hasDefault: true as const }
      : {};

  if (value["kind"] === "entity") {
    const entity = value["entity"];
    if (typeof entity !== "string" || entity === "") return null;
    return { name, kind: "entity", entity, required, ...withDefault };
  }

  if (value["kind"] === "value") {
    const type = value["type"];
    if (typeof type !== "string" || !VALUE_TYPES.has(type)) return null;
    return {
      name,
      kind: "value",
      type: type as TemplateValueType,
      required,
      ...withDefault,
    };
  }

  if (value["kind"] === "list") {
    const item = toListItem(value["item"]);
    if (!item) return null;
    return { name, kind: "list", item, required, ...withDefault };
  }

  return null;
}

/**
 * Turn the raw template rows into the inputs codegen emits types for. Templates
 * without a usable key are skipped; a template with no inputs is kept, since
 * rendering it takes an empty variables object rather than nothing.
 */
export function analyzeDocumentTemplates(
  rawTemplates: RawDocumentTemplate[],
): AnalyzedDocumentTemplate[] {
  const analyzed: AnalyzedDocumentTemplate[] = [];

  for (const template of rawTemplates) {
    if (typeof template.key !== "string" || template.key === "") continue;

    const parsed = parseInputSchema(template.input_schema);
    const rawInputs = isRecord(parsed) ? parsed["inputs"] : null;
    const inputs = Array.isArray(rawInputs)
      ? rawInputs
          .map(toTemplateInput)
          .filter((input): input is TemplateInput => input !== null)
      : [];

    analyzed.push({
      key: template.key,
      name: template.name,
      description: template.description ?? null,
      inputs,
    });
  }

  return analyzed;
}

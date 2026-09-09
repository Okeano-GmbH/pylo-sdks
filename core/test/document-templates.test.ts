import { describe, it, expect } from "vitest";
import { analyzeEntities } from "../src/codegen/analyze.js";
import { analyzeDocumentTemplates } from "../src/codegen/analyze-templates.js";
import { generateIndexFile } from "../src/codegen/generate.js";
import type { RawEntity } from "../src/codegen/fetch-schema.js";
import type { RawDocumentTemplate } from "../src/codegen/fetch-templates.js";

const ALL_ENDPOINTS = {
  is_virtual: false,
  can_list: true,
  can_get_by_id: true,
  can_create: true,
  can_update: true,
  can_bulk_update: true,
  can_delete: true,
};

const einwilligung: RawEntity = {
  name: "Einwilligung",
  shortcode: "ew",
  is_system_entity: false,
  ...ALL_ENDPOINTS,
  entity_fields: {
    data: [
      { name: "id", data_type: "TEXT", validation_string: "required" },
      { name: "name", data_type: "TEXT", validation_string: "optional" },
    ],
  },
  entity_relations: { data: [] },
  entity_related: { data: [] },
} as unknown as RawEntity;

const entities = analyzeEntities([einwilligung]);

const template = (
  key: string,
  inputs: unknown[],
  overrides: Partial<RawDocumentTemplate> = {},
): RawDocumentTemplate => ({
  id: `id-${key}`,
  name: key,
  key,
  description: null,
  input_schema: JSON.stringify({ inputs }),
  ...overrides,
});

function templatesBlockOf(rawTemplates: RawDocumentTemplate[]): string {
  const out = generateIndexFile(
    entities,
    "@pylo/node",
    analyzeDocumentTemplates(rawTemplates),
  );
  const start = out.indexOf("export interface PyloDocumentTemplates");
  if (start === -1) return "";
  return out.slice(start, out.indexOf("}", out.indexOf("\n}", start)) + 1);
}

describe("analyzeDocumentTemplates", () => {
  it("reads the editor's `{ inputs: [...] }` envelope", () => {
    const [analyzed] = analyzeDocumentTemplates([
      template("einwilligung-optik", [
        { name: "einwilligung", kind: "entity", entity: "Einwilligung", required: true },
        { name: "signed_on", kind: "value", type: "date", required: true },
      ]),
    ]);

    expect(analyzed?.key).toBe("einwilligung-optik");
    expect(analyzed?.inputs).toHaveLength(2);
  });

  it("accepts an already-parsed input_schema", () => {
    const [analyzed] = analyzeDocumentTemplates([
      template("x", [], {
        input_schema: {
          inputs: [{ name: "count", kind: "value", type: "number", required: false }],
        },
      }),
    ]);

    expect(analyzed?.inputs).toEqual([
      { name: "count", kind: "value", type: "number", required: false },
    ]);
  });

  // The renderer substitutes a declared default for an omitted argument, so a
  // required input that has one must not be required in the generated type.
  it("marks a required input with a default as optional", () => {
    const block = templatesBlockOf([
      template("x", [
        { name: "signed_on", kind: "value", type: "date", required: true, default: "2026-01-01" },
        { name: "copies", kind: "value", type: "number", required: true, default: 0 },
        { name: "title", kind: "value", type: "text", required: true },
        { name: "blank", kind: "value", type: "text", required: true, default: "" },
      ]),
    ]);

    expect(block).toContain("signed_on?:");
    expect(block).toContain("copies?:");
    expect(block).toContain("title:");
    expect(block).not.toContain("title?:");
    expect(block).toContain("blank:");
  });

  // A malformed row would otherwise become a type that rejects calls the server
  // accepts, so the input is dropped rather than guessed at.
  it("drops unusable inputs and keeps the template", () => {
    const [analyzed] = analyzeDocumentTemplates([
      template("x", [
        { name: "ok", kind: "value", type: "text", required: true },
        { name: "no_kind" },
        { kind: "value", type: "text", required: true },
        { name: "bad_type", kind: "value", type: "colour", required: true },
        { name: "no_entity", kind: "entity", entity: "", required: true },
      ]),
    ]);

    expect(analyzed?.inputs.map((i) => i.name)).toEqual(["ok"]);
  });

  it("survives an unparseable or missing input_schema", () => {
    const analyzed = analyzeDocumentTemplates([
      template("a", [], { input_schema: "{not json" }),
      template("b", [], { input_schema: null }),
    ]);

    expect(analyzed.map((t) => t.inputs)).toEqual([[], []]);
  });

  it("skips a template with no key — there is nothing to render it by", () => {
    expect(analyzeDocumentTemplates([template("", [])])).toEqual([]);
  });
});

describe("generateIndexFile — PyloDocumentTemplates", () => {
  it("maps an entity input to the id or a ref object", () => {
    const block = templatesBlockOf([
      template("einwilligung-optik", [
        { name: "einwilligung", kind: "entity", entity: "Einwilligung", required: true },
        { name: "signed_on", kind: "value", type: "date", required: true },
      ]),
    ]);

    expect(block).toContain("'einwilligung-optik': {");
    expect(block).toContain("einwilligung: string | EinwilligungDocumentRef;");
    expect(block).toContain("signed_on: string | Date;");
  });

  it("marks a non-required input optional", () => {
    const block = templatesBlockOf([
      template("t", [{ name: "note", kind: "value", type: "text", required: false }]),
    ]);

    expect(block).toContain("note?: string;");
  });

  it("types list inputs by their item kind", () => {
    const block = templatesBlockOf([
      template("t", [
        {
          name: "records",
          kind: "list",
          item: { kind: "entity", entity: "Einwilligung" },
          required: true,
        },
        {
          name: "positions",
          kind: "list",
          item: {
            kind: "object",
            fields: [
              { name: "label", type: "text" },
              { name: "amount", type: "number" },
            ],
          },
          required: true,
        },
      ]),
    ]);

    expect(block).toContain("records: Array<string | EinwilligungDocumentRef>;");
    expect(block).toContain(
      "positions: Array<{ label: string; amount: number }>;",
    );
  });

  // The template outlived the entity it was written against; the id still works.
  it("falls back to the id alone for an entity the schema no longer has", () => {
    const block = templatesBlockOf([
      template("t", [
        { name: "ghost", kind: "entity", entity: "Deleted", required: true },
      ]),
    ]);

    expect(block).toContain("ghost: string;");
  });

  it("gives a template with no inputs an empty variables object", () => {
    const block = templatesBlockOf([template("blank", [])]);

    expect(block).toContain("blank: Record<never, never>;");
  });

  it("quotes keys and names that are not identifiers", () => {
    const block = templatesBlockOf([
      template("with-dash", [
        { name: "with-dash", kind: "value", type: "text", required: true },
      ]),
    ]);

    expect(block).toContain("'with-dash': {");
    expect(block).toContain("'with-dash': string;");
  });

  it("registers the map alongside the schema", () => {
    const out = generateIndexFile(
      entities,
      "@pylo/node",
      analyzeDocumentTemplates([template("t", [])]),
    );

    expect(out).toContain("declare module '@pylo/node'");
    expect(out).toContain("documentTemplates: PyloDocumentTemplates;");
  });

  // No templates means "we could not read any" as often as "there are none" —
  // an empty map would type every key as invalid.
  it("emits nothing when there are no templates", () => {
    const out = generateIndexFile(entities, "@pylo/node", []);

    expect(out).not.toContain("PyloDocumentTemplates");
    expect(out).toContain("schema: PyloSchema;");
  });
});

// The renderer reads `id` / `__search_value` to fetch the record and treats
// every other key as an override of what it fetched — so this is not the
// entity's upsert input, whose relation keys would land in the output verbatim.
describe("generateIndexFile — <Entity>DocumentRef", () => {
  function indexOf(rawTemplates: RawDocumentTemplate[]): string {
    return generateIndexFile(
      entities,
      "@pylo/node",
      analyzeDocumentTemplates(rawTemplates),
    );
  }

  it("emits a ref type for each entity a template addresses", () => {
    const out = indexOf([
      template("t", [
        { name: "einwilligung", kind: "entity", entity: "Einwilligung", required: true },
      ]),
    ]);

    expect(out).toContain("export interface EinwilligungDocumentRef {");
    expect(out).toContain("  id?: string;");
    expect(out).toContain("  __search_value?: { field: string; value?: string };");
    expect(out).toContain("  name?: string | null;");
    // Nothing that would be written rather than overridden.
    const block = out.slice(
      out.indexOf("export interface EinwilligungDocumentRef"),
      out.indexOf("}", out.indexOf("export interface EinwilligungDocumentRef")),
    );
    expect(block).not.toContain("__replace_vars");
    expect(block).not.toContain("not_found_behavior");
  });

  it("emits one for a list of entity records too", () => {
    const out = indexOf([
      template("t", [
        {
          name: "records",
          kind: "list",
          item: { kind: "entity", entity: "Einwilligung" },
          required: true,
        },
      ]),
    ]);

    expect(out).toContain("export interface EinwilligungDocumentRef {");
  });

  it("emits none for an entity no template addresses", () => {
    const out = indexOf([
      template("t", [{ name: "note", kind: "value", type: "text", required: true }]),
    ]);

    expect(out).not.toContain("DocumentRef");
  });
});

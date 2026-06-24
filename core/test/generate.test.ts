import { describe, it, expect } from "vitest";
import { analyzeEntities } from "../src/codegen/analyze.js";
import type { RawEntity } from "../src/codegen/fetch-schema.js";
import { generateIndexFile } from "../src/codegen/generate.js";

const field = (name: string, data_type = "TEXT", validation_string = "optional") => ({
  name,
  data_type,
  validation_string,
});

const contact: RawEntity = {
  name: "Contact",
  shortcode: "ct",
  is_system_entity: false,
  entity_fields: {
    data: [
      field("id", "TEXT", "required"),
      field("first_name"),
      field("body", "LONGTEXT"),
      field("created_at", "DATETIME"),
      field("updated_at", "DATETIME"),
    ],
  },
  entity_relations: { data: [] },
  entity_related: { data: [] },
} as unknown as RawEntity;

function updateInputOf(source: string): string {
  const out = generateIndexFile(analyzeEntities([contact]), source);
  const start = out.indexOf("export interface UpdateContactInput");
  return out.slice(start, out.indexOf("export interface", start + 1));
}

describe("generateIndexFile — replace_variables", () => {
  const block = updateInputOf("@pylo/node");

  it("adds a typed replace_variables field to the update input", () => {
    expect(block).toContain("replace_variables?: Array<'first_name' | 'body'>");
  });

  it("excludes system-managed columns from the field-name union", () => {
    const union = block.slice(
      block.indexOf("replace_variables"),
      block.indexOf(";", block.indexOf("replace_variables")),
    );
    for (const sys of ["'id'", "'integer_id'", "'created_at'", "'updated_at'"]) {
      expect(union).not.toContain(sys);
    }
  });

  it("documents the field with a JSDoc comment", () => {
    expect(block).toContain("template variables");
    expect(block).toMatch(/\/\*\*[\s\S]*replace_variables\?: Array</);
  });
});

describe("analyzeEntities — JSON fields", () => {
  // JSON is transferred as stringified JSON over the wire, so the generated
  // type must be a plain string, not a parsed object/array.
  const jsonEntity: RawEntity = {
    name: "Doc",
    shortcode: "dc",
    is_system_entity: false,
    entity_fields: {
      data: [
        field("metadata", "JSON"),
        field("config", "JSON", "required"),
      ],
    },
    entity_relations: { data: [] },
    entity_related: { data: [] },
  } as unknown as RawEntity;

  it("maps a required JSON field to string", () => {
    const [entity] = analyzeEntities([jsonEntity]);
    const config = entity.fields.find((f) => f.name === "config")!;
    expect(config.tsType).toBe("string");
    expect(config.nullable).toBe(false);
  });

  it("maps a nullable JSON field to string | null in generated output", () => {
    const out = generateIndexFile(analyzeEntities([jsonEntity]), "@pylo/node");
    expect(out).toContain("metadata: string | null;");
    expect(out).not.toContain("Record<string, unknown> | unknown[]");
  });
});

describe("generateIndexFile — schema registration", () => {
  it("registers the schema for @pylo/node and @pylo/nextjs", () => {
    for (const source of ["@pylo/node", "@pylo/nextjs"]) {
      const out = generateIndexFile(analyzeEntities([contact]), source);
      expect(out).toContain(`declare module '${source}'`);
      expect(out).toContain("interface PyloRegister");
    }
  });

  it("does not register a schema for @pylo/core", () => {
    const out = generateIndexFile(analyzeEntities([contact]), "@pylo/core");
    expect(out).not.toContain("declare module");
  });
});

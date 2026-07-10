import { describe, it, expect } from "vitest";
import {
  buildUpsertMutation,
  buildBulkUpsertMutation,
  buildDeleteMutation,
} from "../src/mutation-builder.js";

// Collapse whitespace so assertions don't depend on the builder's exact
// indentation/newlines.
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("buildUpsertMutation", () => {
  it("emits an update mutation with a single input variable", () => {
    const { query, variables } = buildUpsertMutation("contact", "Contact", {
      name: "Ada",
    });
    expect(norm(query)).toContain("mutation UpdateContact($input: UpdateContactInput!)");
    expect(norm(query)).toContain("updateContact(input: $input) { data { id } }");
    expect(variables).toEqual({ input: { name: "Ada" } });
  });
});

describe("buildBulkUpsertMutation", () => {
  it("emits a bulkUpdate mutation with a list input variable", () => {
    const inputs = [{ name: "Ada" }, { id: "1", name: "Grace" }];
    const { query, variables } = buildBulkUpsertMutation("contact", "Contact", inputs);
    expect(norm(query)).toContain(
      "mutation BulkUpdateContact($inputs: [UpdateContactInput!]!)",
    );
    expect(norm(query)).toContain("bulkUpdateContact(inputs: $inputs) { data { id } }");
    expect(variables).toEqual({ inputs });
  });

  it("passes an empty batch through unchanged", () => {
    const { variables } = buildBulkUpsertMutation("contact", "Contact", []);
    expect(variables).toEqual({ inputs: [] });
  });
});

describe("buildDeleteMutation", () => {
  it("emits a delete mutation with an ids variable", () => {
    const { query, variables } = buildDeleteMutation("contact", "Contact", ["1", "2"]);
    expect(norm(query)).toContain("mutation DeleteContact($ids: [ID!]!)");
    expect(norm(query)).toContain("deleteContact(ids: $ids) { data { success } }");
    expect(variables).toEqual({ ids: ["1", "2"] });
  });
});

import { describe, it, expectTypeOf } from "vitest";
import type { PyloClient } from "../src/client.js";
import type { PyloRenderedDocument } from "../src/documents.js";

interface Schema {
  contact: {
    fields: { id: string };
    relations: Record<never, never>;
    capabilities: "list";
  };
}

interface EinwilligungDocumentRef {
  id?: string;
  __search_value?: { field: string; value?: string };
  name?: string | null;
}

// What codegen emits for a tenant with one template.
interface Templates {
  "einwilligung-optik": {
    einwilligung: string | EinwilligungDocumentRef;
    signed_on: string | Date;
    note?: string;
  };
  "inventur-summary": {
    inventur: string | EinwilligungDocumentRef;
  };
}

declare const pylo: PyloClient<Schema, Templates>;
declare const untyped: PyloClient<Schema>;

describe("documents.generate — typing", () => {
  it("accepts a record id or the entity's input object", async () => {
    expectTypeOf(
      await pylo.documents.generate("einwilligung-optik", {
        einwilligung: "e1",
        signed_on: new Date(),
      }),
    ).toEqualTypeOf<PyloRenderedDocument>();

    await pylo.documents.generate("einwilligung-optik", {
      einwilligung: { __search_value: { field: "name", value: "1234" }, name: "1234" },
      signed_on: "2026-09-07",
      note: "optional",
    });
  });

  it("rejects an unknown template", () => {
    // @ts-expect-error — no such template key
    void pylo.documents.generate("nope", {});
  });

  it("rejects variables from another template", () => {
    // @ts-expect-error — `inventur` belongs to inventur-summary
    void pylo.documents.generate("einwilligung-optik", { inventur: "i1" });
  });

  it("rejects a missing required variable", () => {
    // @ts-expect-error — `signed_on` is required
    void pylo.documents.generate("einwilligung-optik", { einwilligung: "e1" });
  });

  it("rejects a variable of the wrong type", () => {
    void pylo.documents.generate("einwilligung-optik", {
      einwilligung: "e1",
      // @ts-expect-error — a date input takes a string or a Date
      signed_on: 20260907,
    });
  });

  // No generated map registered: any key, any variables, rather than nothing.
  it("stays open without a registered template map", async () => {
    expectTypeOf(
      await untyped.documents.generate("anything", { whatever: 1 }),
    ).toEqualTypeOf<PyloRenderedDocument>();
  });
});

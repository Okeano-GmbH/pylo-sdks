import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildGenerateDocumentMutation } from "../src/documents.js";

// Intercept the transport so the runtime path — mutation built, request issued,
// response unwrapped — is exercised without a live API.
const graphqlRequest = vi.fn();

vi.mock("@pylo/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pylo/auth")>();
  return { ...actual, graphqlRequest };
});

const { createPyloClient, PyloError } = await import("../src/client.js");

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

interface TestSchema {
  contact: {
    fields: { id: string };
    relations: Record<never, never>;
    capabilities: "list";
  };
}

interface TestTemplates {
  "einwilligung-optik": {
    einwilligung: string | { id?: string; name?: string };
    signed_on: string | Date;
  };
}

const client = createPyloClient<TestSchema, TestTemplates>({
  endpoint: "https://example.test/graphql",
  auth: async () => ({ token: "t" }),
});

beforeEach(() => {
  graphqlRequest.mockReset();
});

describe("buildGenerateDocumentMutation", () => {
  it("sends the template key and the variables as a JSON object", () => {
    const { query, variables } = buildGenerateDocumentMutation("einwilligung-optik", {
      einwilligung: "e1",
      signed_on: "2026-09-07",
    });

    expect(norm(query)).toContain("mutation GenerateDocument($input: DocumentInput!)");
    expect(norm(query)).toContain("generateDocument(input: $input)");
    // `RenderedDocument` is returned bare, not in a `data` envelope.
    expect(norm(query)).not.toContain("data {");
    expect(variables).toEqual({
      input: {
        template_key: "einwilligung-optik",
        variables: { einwilligung: "e1", signed_on: "2026-09-07" },
      },
    });
  });

  it("passes the file name and page options through under their wire names", () => {
    const { variables } = buildGenerateDocumentMutation(
      "t",
      {},
      { fileName: "einwilligung.pdf", pageOptions: { width: "210mm", scale: 0.8 } },
    );

    expect(variables["input"]).toMatchObject({
      file_name: "einwilligung.pdf",
      options: { width: "210mm", scale: 0.8 },
    });
  });

  it("omits the optional keys it was not given", () => {
    const { variables } = buildGenerateDocumentMutation("t", {});

    expect(Object.keys(variables["input"] as object)).toEqual([
      "template_key",
      "variables",
    ]);
  });

  it("sends an empty variables object when there are none", () => {
    const { variables } = buildGenerateDocumentMutation("t", undefined);

    expect(variables["input"]).toMatchObject({ variables: {} });
  });
});

describe("client.documents.generate — runtime", () => {
  it("returns the stored document", async () => {
    graphqlRequest.mockResolvedValue({
      data: {
        generateDocument: {
          id: "d1",
          template_key: "einwilligung-optik",
          media_id: "m1",
          file_name: "einwilligung-optik-20260907-100000.pdf",
          rendered_at: "2026-09-07T10:00:00Z",
        },
      },
    });

    const document = await client.documents.generate("einwilligung-optik", {
      einwilligung: { id: "e1", name: "1234" },
      signed_on: "2026-09-07",
    });

    expect(document.media_id).toBe("m1");
    const [, , variables] = graphqlRequest.mock.calls[0]!;
    expect(variables).toMatchObject({
      input: { template_key: "einwilligung-optik" },
    });
  });

  it("throws when the payload has no generateDocument", async () => {
    graphqlRequest.mockResolvedValue({ data: { generateDocument: null } });

    await expect(
      client.documents.generate("einwilligung-optik", {
        einwilligung: "e1",
        signed_on: "2026-09-07",
      }),
    ).rejects.toThrow(PyloError);
  });
});

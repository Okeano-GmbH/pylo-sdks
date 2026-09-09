import { graphqlRequest } from "@pylo/auth";
import type { SchemaFetcher } from "./fetch-schema.js";
import type { ResolvedPyloConfig } from "./config.js";

export const DOCUMENT_TEMPLATE_LIST_QUERY = `
query PyloDocumentTemplateFetch($pagination: PaginationInput) {
  pyloDocumentTemplateList(pagination: $pagination) {
    data {
      id
      name
      key
      description
      input_schema
    }
    pagination {
      total
      has_more_pages
      current_page
    }
  }
}
`;

export interface RawDocumentTemplate {
  id: string;
  name: string;
  key: string;
  description: string | null;
  // The editor writes `{"inputs":[…]}`. JSON columns travel as strings over
  // GraphQL, but a server that types the column as a JSON scalar sends the
  // object itself, so both are accepted downstream.
  input_schema: string | Record<string, unknown> | null;
}

export interface DocumentTemplateListResponse {
  pyloDocumentTemplateList: {
    data: RawDocumentTemplate[];
    pagination: {
      total: number;
      has_more_pages: boolean;
      current_page: number;
    };
  };
}

/**
 * Read every document template through the supplied transport. Feed the result
 * to `analyzeDocumentTemplates`.
 *
 * Unlike `fetchSchemaWith` this never throws: a tenant on a backend without the
 * `PyloDocumentTemplate` entity, or an API key without read access to it, must
 * still be able to generate entity types. Both cases yield an empty list and a
 * warning, and codegen then emits no template map at all — leaving
 * `documents.generate` loosely typed rather than typed as "no template exists".
 */
export async function fetchDocumentTemplatesWith(
  request: SchemaFetcher,
): Promise<RawDocumentTemplate[]> {
  const all: RawDocumentTemplate[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    let response;
    try {
      response = await request<DocumentTemplateListResponse>(
        DOCUMENT_TEMPLATE_LIST_QUERY,
        { pagination: { page, per_page: 50 } },
      );
    } catch (err) {
      console.warn(
        `  skipping document templates: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }

    if (response.errors || !response.data?.pyloDocumentTemplateList) {
      const message = Array.isArray(response.errors)
        ? response.errors.map((e) => e.message).join(", ")
        : response.errors?.generalError?.message ?? "endpoint unavailable";
      console.warn(`  skipping document templates: ${message}`);
      return [];
    }

    const { data, pagination } = response.data.pyloDocumentTemplateList;
    all.push(...data);
    hasMore = pagination.has_more_pages;
    page++;
  }

  return all;
}

export async function fetchDocumentTemplates(
  config: ResolvedPyloConfig,
): Promise<RawDocumentTemplate[]> {
  return fetchDocumentTemplatesWith((query, variables) =>
    graphqlRequest(config.endpoint, query, variables, { apiKey: config.apiKey }),
  );
}

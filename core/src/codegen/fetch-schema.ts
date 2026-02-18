import type { GraphQLResponse } from "@pylo/auth";
import type { ResolvedPyloConfig } from "./config.js";

async function graphqlRequestWithApiKey<T>(
  endpoint: string,
  query: string,
  variables?: Record<string, unknown>,
  apiKey?: string,
): Promise<GraphQLResponse<T>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers["pylo-api-key"] = apiKey;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });

  return response.json() as Promise<GraphQLResponse<T>>;
}

const ENTITY_LIST_QUERY = `
query PyloSchemaFetch($pagination: PaginationInput) {
  entityList(pagination: $pagination) {
    data {
      name
      shortcode
      is_system_entity
      entity_fields {
        data {
          name
          data_type
          validation_string
          form_type
          default_value
          variant_entity_field {
            data {
              name
            }
          }
        }
      }
      entity_relations {
        data {
          type
          field_name
          target_field_name
          target_entity {
            data {
              name
            }
          }
          entity_is_tightly_coupled
          target_entity_is_tightly_coupled
          allow_connect_create
          allow_connect_existing
        }
      }
      entity_related {
        data {
          type
          field_name
          target_field_name
          entity {
            data {
              name
            }
          }
          entity_is_tightly_coupled
          target_entity_is_tightly_coupled
          allow_connect_create
          allow_connect_existing
        }
      }
    }
    pagination {
      total
      has_more_pages
      current_page
    }
  }
}
`;

export interface RawEntityField {
  name: string;
  data_type: string;
  validation_string: string | null;
  form_type: string | null;
  default_value: string | null;
  variant_entity_field: {
    data: { name: string } | null;
  } | null;
}

export interface RawEntityRelation {
  type: string;
  field_name: string;
  target_field_name: string | null;
  entity?: {
    data: { name: string } | null;
  };
  target_entity?: {
    data: { name: string } | null;
  };
  entity_is_tightly_coupled: boolean;
  target_entity_is_tightly_coupled: boolean;
  allow_connect_create: boolean;
  allow_connect_existing: boolean;
}

export interface RawEntity {
  name: string;
  shortcode: string;
  is_system_entity: boolean;
  entity_fields: {
    data: RawEntityField[];
  } | null;
  entity_relations: {
    data: RawEntityRelation[];
  } | null;
  entity_related: {
    data: RawEntityRelation[];
  } | null;
}

interface EntityListResponse {
  entityList: {
    data: RawEntity[];
    pagination: {
      total: number;
      has_more_pages: boolean;
      current_page: number;
    };
  };
}

export async function fetchSchema(config: ResolvedPyloConfig): Promise<RawEntity[]> {
  const allEntities: RawEntity[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await graphqlRequestWithApiKey<EntityListResponse>(
      config.endpoint,
      ENTITY_LIST_QUERY,
      { pagination: { page, per_page: 50 } },
      config.apiKey,
    );

    if (response.errors) {
      const errMsg =
        Array.isArray(response.errors)
          ? response.errors.map((e) => e.message).join(", ")
          : response.errors.generalError?.message ?? "Unknown error";
      throw new Error(`Failed to fetch schema: ${errMsg}`);
    }

    if (!response.data) {
      throw new Error("No data returned from schema fetch");
    }

    const { data, pagination } = response.data.entityList;
    allEntities.push(...data);
    hasMore = pagination.has_more_pages;
    page++;
  }

  return allEntities;
}

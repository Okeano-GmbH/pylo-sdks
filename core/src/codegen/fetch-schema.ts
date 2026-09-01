import { graphqlRequest } from "@pylo/auth";
import type { GraphQLResponse } from "@pylo/auth";
import type { ResolvedPyloConfig } from "./config.js";

export const ENTITY_LIST_QUERY = `
query PyloSchemaFetch($pagination: PaginationInput) {
  entityList(pagination: $pagination) {
    data {
      name
      shortcode
      is_system_entity
      is_virtual
      can_list
      can_get_by_id
      can_create
      can_update
      can_bulk_update
      can_delete
      entity_fields {
        data {
          name
          data_type
          is_readable
          is_writeable
          validation_string
          form_type
          default_value
          variant_entity_field {
            data {
              name
            }
          }
          entity_field_enum_values {
            data {
              value
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
  // The backend's own gates for whether a field lands on the output type and on
  // the input types. A field without the former cannot be selected; one without
  // the latter cannot be written. Only an explicit `false` excludes.
  is_readable?: boolean | null;
  is_writeable?: boolean | null;
  validation_string: string | null;
  form_type: string | null;
  default_value: string | null;
  variant_entity_field: {
    data: { name: string } | null;
  } | null;
  entity_field_enum_values: {
    data: Array<{ value: string }>;
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
  // Whether the entity has no list/byId/upsert/delete endpoints. Being a system
  // entity does not imply this — `PyloUser` and friends have the full set — so
  // this is the flag codegen gates the endpoints on.
  is_virtual: boolean;
  // Which generic endpoints the served schema actually exposes.
  can_list: boolean;
  can_get_by_id: boolean;
  can_create: boolean;
  can_update: boolean;
  can_bulk_update: boolean;
  can_delete: boolean;
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

export interface EntityListResponse {
  entityList: {
    data: RawEntity[];
    pagination: {
      total: number;
      has_more_pages: boolean;
      current_page: number;
    };
  };
}

/**
 * Transport-agnostic GraphQL request used to introspect the Pylo schema. Lets
 * callers that aren't the CLI (e.g. a browser using cookie auth via a proxy, or
 * a server using a different api-key header) reuse the pagination logic in
 * `fetchSchemaWith` without depending on `ResolvedPyloConfig`.
 */
export type SchemaFetcher = <T>(
  query: string,
  variables: Record<string, unknown>,
) => Promise<GraphQLResponse<T>>;

/**
 * Paginate through `entityList` using the supplied transport and return the
 * raw entities. Feed the result to `analyzeEntities`.
 */
export async function fetchSchemaWith(request: SchemaFetcher): Promise<RawEntity[]> {
  const allEntities: RawEntity[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await request<EntityListResponse>(ENTITY_LIST_QUERY, {
      pagination: { page, per_page: 50 },
    });

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

export async function fetchSchema(config: ResolvedPyloConfig): Promise<RawEntity[]> {
  return fetchSchemaWith((query, variables) =>
    graphqlRequest(config.endpoint, query, variables, { apiKey: config.apiKey }),
  );
}

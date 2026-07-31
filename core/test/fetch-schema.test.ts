import { describe, it, expect } from "vitest";
import type { GraphQLResponse } from "@pylo/auth";
import { ENTITY_LIST_QUERY, fetchSchemaWith } from "../src/codegen/fetch-schema.js";

const page = (entities: unknown[], hasMore = false) => ({
  data: {
    entityList: {
      data: entities,
      pagination: { total: entities.length, has_more_pages: hasMore, current_page: 1 },
    },
  },
});

const entity = (name: string) => ({
  name,
  shortcode: name.slice(0, 2).toLowerCase(),
  is_system_entity: false,
  entity_fields: { data: [] },
  entity_relations: { data: [] },
  entity_related: { data: [] },
});

// Records every query it is handed, so a test can assert which field set the
// entities were actually fetched with.
function recorder(
  respond: (query: string, page: number) => unknown,
): { queries: string[]; request: <T>(q: string, v: Record<string, unknown>) => Promise<GraphQLResponse<T>> } {
  const queries: string[] = [];
  return {
    queries,
    request: async <T,>(query: string, variables: Record<string, unknown>) => {
      queries.push(query);
      const pagination = variables["pagination"] as { page: number };
      return respond(query, pagination.page) as GraphQLResponse<T>;
    },
  };
}

describe("fetchSchemaWith", () => {
  it("asks for is_virtual", async () => {
    const { queries, request } = recorder(() => page([entity("Contact")]));
    await fetchSchemaWith(request);
    expect(queries).toEqual([ENTITY_LIST_QUERY]);
    expect(ENTITY_LIST_QUERY).toContain("is_virtual");
  });

  it("pages through every entity with the one query", async () => {
    const { queries, request } = recorder((_query, pageNumber) =>
      page([entity(`Entity${pageNumber}`)], pageNumber < 3),
    );

    const entities = await fetchSchemaWith(request);

    expect(entities.map((e) => e.name)).toEqual(["Entity1", "Entity2", "Entity3"]);
    expect(queries).toEqual([ENTITY_LIST_QUERY, ENTITY_LIST_QUERY, ENTITY_LIST_QUERY]);
  });

  it("surfaces a request error rather than returning a partial schema", async () => {
    const { request } = recorder(() => ({ errors: [{ message: "Unauthenticated" }] }));
    await expect(fetchSchemaWith(request)).rejects.toThrow("Unauthenticated");
  });

  it("surfaces an error raised on a later page", async () => {
    const { queries, request } = recorder((_query, pageNumber) =>
      pageNumber === 1
        ? page([entity("Contact")], true)
        : { errors: [{ message: "Server error" }] },
    );

    await expect(fetchSchemaWith(request)).rejects.toThrow("Server error");
    expect(queries).toEqual([ENTITY_LIST_QUERY, ENTITY_LIST_QUERY]);
  });
});

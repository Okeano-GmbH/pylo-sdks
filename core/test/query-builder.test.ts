import { describe, it, expect } from "vitest";
import {
  buildListQuery,
  buildByIdQuery,
  buildMeQuery,
  capitalize,
} from "../src/query-builder.js";

// Collapse whitespace so assertions don't depend on the builder's exact
// indentation/newlines.
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

// Each pagination block contains exactly one `has_more_pages`, so counting it
// tells us how many pagination blocks a query emits. Top-level list always
// emits one; a nested hasMany with `pagination` adds a second.
const paginationBlocks = (q: string) => q.match(/has_more_pages/g)?.length ?? 0;

describe("buildListQuery", () => {
  it("emits scalar fields and the top-level pagination block", () => {
    const { query, variables } = buildListQuery("contact", {
      select: { name: true },
    });
    expect(norm(query)).toContain("contactList");
    expect(norm(query)).toContain("data { name }");
    expect(paginationBlocks(query)).toBe(1);
    expect(variables).toEqual({});
  });

  it("expands variant fields with their data/value/variant sub-selection", () => {
    const { query } = buildListQuery("contact", {
      select: { title_variants: true },
    });
    expect(norm(query)).toContain("title_variants { data { value variant } }");
  });

  it("emits a hasOne relation without a nested pagination block", () => {
    const { query } = buildListQuery("contact", {
      select: { company: { select: { name: true } } },
    });
    expect(norm(query)).toContain("company { data { name } }");
    expect(paginationBlocks(query)).toBe(1); // top-level only
  });

  it("emits a nested pagination block + arg when pagination is supplied", () => {
    const { query, variables } = buildListQuery("contact", {
      select: { items: { select: { id: true }, pagination: { per_page: 10 } } },
    });
    expect(norm(query)).toContain("items(pagination: $r_items_pagination) { data { id }");
    expect(norm(query)).toContain("$r_items_pagination: PaginationInput");
    expect(paginationBlocks(query)).toBe(2); // top-level + nested
    expect(variables).toEqual({ r_items_pagination: { per_page: 10 } });
  });

  it("omits the nested pagination block when pagination is not supplied", () => {
    const { query } = buildListQuery("contact", {
      select: { items: { select: { id: true } } },
    });
    expect(norm(query)).toContain("items { data { id } }");
    expect(paginationBlocks(query)).toBe(1); // top-level only
  });

  it("wires a relation filter into a typed variable", () => {
    const { query, variables } = buildListQuery("contact", {
      select: { items: { select: { id: true }, filter: { query: [] } } },
    });
    expect(norm(query)).toContain("items(filter: $r_items_filter)");
    expect(norm(query)).toContain("$r_items_filter: FilterInput");
    expect(variables).toEqual({ r_items_filter: { query: [] } });
  });

  it("threads top-level filter/pagination args", () => {
    const { query, variables } = buildListQuery("contact", {
      select: { name: true },
      filter: { query: [] },
      pagination: { page: 2 },
    });
    expect(norm(query)).toContain("contactList(filter: $filter, pagination: $pagination)");
    expect(variables).toEqual({ filter: { query: [] }, pagination: { page: 2 } });
  });

  it("throws when a relation is selected without an explicit select", () => {
    expect(() =>
      buildListQuery("contact", { select: { items: { pagination: {} } } }),
    ).toThrow(/Relation "items" requires an explicit/);
  });

  it("throws when no select is provided", () => {
    expect(() => buildListQuery("contact", undefined)).toThrow(
      /requires an explicit 'select'/,
    );
  });

  it("throws when select is empty", () => {
    expect(() => buildListQuery("contact", { select: {} })).toThrow(
      /requires an explicit 'select'/,
    );
  });
});

describe("buildByIdQuery", () => {
  it("builds an id-keyed query with the requested fields", () => {
    const { query, variables } = buildByIdQuery("blogPost", "abc", {
      select: { id: true },
    });
    expect(norm(query)).toContain("blogPostById(id: $id) { data { id }");
    expect(variables).toEqual({ id: "abc" });
  });

  it("throws when no select is provided", () => {
    expect(() => buildByIdQuery("blogPost", "abc", undefined)).toThrow(
      /requires an explicit 'select'/,
    );
  });
});

describe("capitalize", () => {
  it("recovers a PascalName from an entity key", () => {
    expect(capitalize("blogPost")).toBe("BlogPost");
    expect(capitalize("contact")).toBe("Contact");
  });
});

describe("buildMeQuery", () => {
  it("builds a `me` query with the requested fields", () => {
    const { query, variables } = buildMeQuery({
      select: { authenticaton_method: true },
    });
    expect(norm(query)).toContain("query Me { me { authenticaton_method }");
    expect(variables).toEqual({});
  });

  it("does not wrap the payload in a `data` envelope", () => {
    const { query } = buildMeQuery({ select: { id: true } });
    expect(norm(query)).toContain("me { id }");
    expect(norm(query)).not.toContain("me { data");
  });

  it("expands relations the same way byId does", () => {
    const { query } = buildMeQuery({
      select: { current_user: { select: { id: true, email: true } } },
    });
    expect(norm(query)).toContain("current_user { data { id email } }");
  });

  it("takes no id argument", () => {
    const { query } = buildMeQuery({ select: { id: true } });
    expect(query).not.toContain("$id");
  });

  it("declares variables for relation filters", () => {
    const { query, variables } = buildMeQuery({
      select: {
        my_users: {
          select: { id: true },
          pagination: { per_page: 5 },
        },
      },
    });
    expect(query).toContain("query Me($");
    expect(Object.keys(variables)).not.toHaveLength(0);
  });

  it("throws when no select is provided", () => {
    expect(() => buildMeQuery(undefined)).toThrow(
      /requires an explicit 'select'/,
    );
  });
});

import { describe, it, expectTypeOf } from "vitest";
import type { PyloClient } from "../src/client.js";
import type {
  CallableEntityName,
  EntityNameWith,
  HasCapability,
} from "../src/types.js";

type NoRelations = Record<never, never>;

type SearchValue = { field: string; value?: string };
interface ProjectInput {
  id?: string;
  __search_value?: SearchValue;
  title?: string;
}

// Mirrors what codegen emits once the backend reports its `can_*` flags: the
// granted endpoints as a string union, and mutation inputs only where there is
// a mutation to send them to.
interface CapabilitySchema {
  // Every endpoint — an ordinary business entity.
  project: {
    fields: { id: string; title: string };
    relations: NoRelations;
    createInput: ProjectInput;
    updateInput: ProjectInput;
    capabilities: "list" | "byId" | "create" | "update" | "bulkUpsert" | "delete";
  };
  // Readable, never written: PyloUsageReport opts out of create/update/delete.
  usageReport: {
    fields: { id: string; period: string };
    relations: NoRelations;
    capabilities: "list" | "byId";
  };
  // Hand-written create/update mutations, but no bulkUpdate — PyloApiKey,
  // Entity, PyloPermission and PyloAco all land here.
  apiKey: {
    fields: { id: string; label: string };
    relations: NoRelations;
    createInput: ProjectInput;
    updateInput: ProjectInput;
    capabilities: "list" | "byId" | "create" | "update" | "delete";
  };
  // Generated before capabilities existed: no `capabilities` key at all.
  legacy: {
    fields: { id: string; name: string };
    relations: NoRelations;
    updateInput: ProjectInput;
  };
  me: {
    fields: { authenticaton_method: string };
    relations: NoRelations;
    virtual: true;
    capabilities: never;
  };
}

type Client = PyloClient<CapabilitySchema>;

describe("PyloClient — capability narrowing", () => {
  it("keeps every method on an entity that has every endpoint", () => {
    expectTypeOf<Client["project"]>().toHaveProperty("list");
    expectTypeOf<Client["project"]>().toHaveProperty("byId");
    expectTypeOf<Client["project"]>().toHaveProperty("upsert");
    expectTypeOf<Client["project"]>().toHaveProperty("bulkUpsert");
    expectTypeOf<Client["project"]>().toHaveProperty("delete");
  });

  it("drops the mutations from a read-only entity", () => {
    expectTypeOf<Client["usageReport"]>().toHaveProperty("list");
    expectTypeOf<Client["usageReport"]>().toHaveProperty("byId");
    expectTypeOf<Client["usageReport"]>().not.toHaveProperty("upsert");
    expectTypeOf<Client["usageReport"]>().not.toHaveProperty("bulkUpsert");
    expectTypeOf<Client["usageReport"]>().not.toHaveProperty("delete");
  });

  // The case the old all-or-nothing model could not express: single-row upserts
  // work, the batched one has no endpoint behind it.
  it("drops only bulkUpsert where there is no bulkUpdate mutation", () => {
    expectTypeOf<Client["apiKey"]>().toHaveProperty("upsert");
    expectTypeOf<Client["apiKey"]>().toHaveProperty("delete");
    expectTypeOf<Client["apiKey"]>().not.toHaveProperty("bulkUpsert");
  });

  // Aggregation is keyed by entity name rather than generated per entity, so it
  // survives even where every other endpoint is gone.
  it("keeps aggregate and count on every entity", () => {
    expectTypeOf<Client["usageReport"]>().toHaveProperty("aggregate");
    expectTypeOf<Client["usageReport"]>().toHaveProperty("count");
    expectTypeOf<Client["project"]>().toHaveProperty("aggregate");
  });

  // An SDK upgrade must not empty out a client generated against an older
  // backend, so a schema that declares nothing keeps everything.
  it("treats a schema without capabilities as fully capable", () => {
    expectTypeOf<Client["legacy"]>().toHaveProperty("list");
    expectTypeOf<Client["legacy"]>().toHaveProperty("upsert");
    expectTypeOf<Client["legacy"]>().toHaveProperty("bulkUpsert");
    expectTypeOf<Client["legacy"]>().toHaveProperty("delete");
  });

  it("keeps `me` off the entity mapping — it has its own method", () => {
    expectTypeOf<Client["me"]>().toBeFunction();
  });
});

describe("capability type helpers", () => {
  it("answers per entity and endpoint", () => {
    expectTypeOf<HasCapability<CapabilitySchema, "project", "delete">>().toEqualTypeOf<true>();
    expectTypeOf<HasCapability<CapabilitySchema, "usageReport", "delete">>().toEqualTypeOf<false>();
    expectTypeOf<HasCapability<CapabilitySchema, "apiKey", "bulkUpsert">>().toEqualTypeOf<false>();
    expectTypeOf<HasCapability<CapabilitySchema, "me", "list">>().toEqualTypeOf<false>();
  });

  it("selects the entities carrying an endpoint", () => {
    expectTypeOf<EntityNameWith<CapabilitySchema, "list">>().toEqualTypeOf<
      "project" | "usageReport" | "apiKey" | "legacy"
    >();
    expectTypeOf<EntityNameWith<CapabilitySchema, "bulkUpsert">>().toEqualTypeOf<
      "project" | "legacy"
    >();
  });

  it("counts an entity as callable when any endpoint remains", () => {
    expectTypeOf<CallableEntityName<CapabilitySchema>>().toEqualTypeOf<
      "project" | "usageReport" | "apiKey" | "legacy"
    >();
  });
});

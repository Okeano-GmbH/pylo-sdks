import type { PyloEventInput } from "./shared-types.js";

interface BuildResult {
  query: string;
  variables: Record<string, unknown>;
}

export function buildUpsertMutation(
  _entityKey: string,
  pascalName: string,
  input: Record<string, unknown>,
): BuildResult {
  const mutation = `mutation Update${pascalName}($input: Update${pascalName}Input!) {
  update${pascalName}(input: $input) {
    data {
      id
    }
  }
}`;

  return {
    query: mutation,
    variables: { input },
  };
}

// Batch upsert: reuses the per-entity `Update${pascalName}Input` and the
// backend `bulkUpdate${pascalName}` mutation, which upserts each element (rows
// without an `id`/`__search_value` are created) inside a single all-or-nothing
// transaction and returns the affected rows as a list.
export function buildBulkUpsertMutation(
  _entityKey: string,
  pascalName: string,
  inputs: Record<string, unknown>[],
): BuildResult {
  const mutation = `mutation BulkUpdate${pascalName}($inputs: [Update${pascalName}Input!]!) {
  bulkUpdate${pascalName}(inputs: $inputs) {
    data {
      id
    }
  }
}`;

  return {
    query: mutation,
    variables: { inputs },
  };
}

export function buildDeleteMutation(
  _entityKey: string,
  pascalName: string,
  ids: string[],
): BuildResult {
  const mutation = `mutation Delete${pascalName}($ids: [ID!]!) {
  delete${pascalName}(ids: $ids) {
    data {
      success
    }
  }
}`;

  return {
    query: mutation,
    variables: { ids },
  };
}

export function buildIngestEventsMutation(events: PyloEventInput[]): BuildResult {
  const mutation = `mutation IngestPyloEventData($input: [PyloEventInput!]!) {
  ingestPyloEventData(input: $input) {
    data {
      event_name
      ts
      properties
    }
  }
}`;

  return {
    query: mutation,
    variables: { input: events },
  };
}

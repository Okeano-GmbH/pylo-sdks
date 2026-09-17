import type { PyloEventInput } from "./shared-types.js";

interface BuildResult {
  query: string;
  variables: Record<string, unknown>;
}

interface UpsertBuildResult extends BuildResult {
  // The mutation the response is keyed by.
  field: string;
}

export function buildUpsertMutation(
  _entityKey: string,
  pascalName: string,
  input: Record<string, unknown>,
): UpsertBuildResult {
  const field = `upsert${pascalName}`;

  const mutation = `mutation Upsert${pascalName}($input: Upsert${pascalName}Input!) {
  ${field}(input: $input) {
    data {
      id
    }
  }
}`;

  return {
    query: mutation,
    variables: { input },
    field,
  };
}

// Batch upsert: upserts each element (rows without an `id`/`__search_value` are
// created) inside a single all-or-nothing transaction and returns the affected
// rows as a list.
export function buildBulkUpsertMutation(
  _entityKey: string,
  pascalName: string,
  inputs: Record<string, unknown>[],
): UpsertBuildResult {
  const field = `bulkUpsert${pascalName}`;

  const mutation = `mutation BulkUpsert${pascalName}($inputs: [Upsert${pascalName}Input!]!) {
  ${field}(inputs: $inputs) {
    data {
      id
    }
  }
}`;

  return {
    query: mutation,
    variables: { inputs },
    field,
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

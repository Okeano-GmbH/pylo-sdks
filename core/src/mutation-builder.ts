import type { FilterInput, PyloEventInput } from "./shared-types.js";
import { buildSelectionSet, capitalize, requireSelect } from "./query-builder.js";

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

// Batch upsert: upserts each element (rows without an `id`/`_search_value` are
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

export interface SubscriptionMutationInput {
  select: unknown;
  filter?: FilterInput | undefined;
  // Set to update an existing subscription in place.
  id?: string | undefined;
  connectionId: string;
  onCreate: boolean;
  onUpdate: boolean;
  onDelete: boolean;
}

// Registers a subscription with the websocket-service. The server keeps the
// `fields { … }` selection as text and replays it per event, so it is the
// projection every event carries; `id` is always added so events can be
// matched to rows.
export function buildSubscriptionMutation(
  entityKey: string,
  input: SubscriptionMutationInput,
): UpsertBuildResult {
  const select = requireSelect(entityKey, "subscribe", input.select);
  const selection = buildSelectionSet({ ...select, id: true }, {}, new Map(), "", true);
  const field = `upsert${capitalize(entityKey)}Subscription`;

  const mutation = `mutation ${capitalize(field)}($subscription: SubscriptionInput, $filter: FilterInput) {
  ${field}(subscription: $subscription, filter: $filter) {
    subscription {
      webserviceUrl
      connectionId
      id
    }
    fields {
      ${selection}
    }
  }
}`;

  return {
    query: mutation,
    variables: {
      subscription: {
        ...(input.id !== undefined ? { id: input.id } : {}),
        connectionId: input.connectionId,
        onCreate: input.onCreate,
        onUpdate: input.onUpdate,
        onDelete: input.onDelete,
      },
      ...(input.filter !== undefined ? { filter: input.filter } : {}),
    },
    field,
  };
}

// Idempotent: an unknown id, or one on another connection, still succeeds.
export function buildDeleteSubscriptionMutation(id: string, connectionId: string): BuildResult {
  return {
    query: `mutation DeleteSubscription($id: ID!, $connectionId: String!) {
  deleteSubscription(id: $id, connectionId: $connectionId) {
    data {
      success
    }
  }
}`,
    variables: { id, connectionId },
  };
}

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

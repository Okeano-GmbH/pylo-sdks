import { gql, GraphQLClient } from "graphql-request";
import type { FilterOperatorsType } from "../filter-conditions";
import { paginationDataStr, type PaginationData } from "../pagination";

export const capitalizeFirstLetter = (string: string) => {
  return string.charAt(0).toUpperCase() + string.slice(1);
};

export const ensureFirstLetterLowercase = (str: string) => {
  if (!str || typeof str !== "string") {
    throw new Error("Input must be a non-empty string");
  }

  return str.charAt(0).toLowerCase() + str.slice(1);
};

// Build nested GraphQL selection strings from dotted field paths.
// For example:
// [
//   'title',
//   'T2_variants.value',
//   'T2_variants.variant',
//   'T2_variants.meta.author.name'
// ]
// ->
// title\nT2_variants {\n  data {\n    value\n    variant\n    meta {\n      data {\n        author {\n          data {\n            name\n          }\n        }\n      }\n    }\n  }\n}
export const buildNestedDataFieldsForRelations = (
  fields?: string[]
): string => {
  if (!fields || fields.length === 0) return "";

  const simpleFields: Set<string> = new Set();
  const relationToSubpaths: Map<string, Set<string>> = new Map();

  for (const field of fields) {
    if (!field.includes(".")) {
      simpleFields.add(field);
      continue;
    }
    const [relation, ...rest] = field.split(".");

    if (relation) {
      if (rest.length === 0) {
        simpleFields.add(relation);
        continue;
      }
      const existing = relationToSubpaths.get(relation) ?? new Set<string>();
      existing.add(rest.join("."));
      relationToSubpaths.set(relation, existing);
    }
  }

  const buildNested = (parts: string[]): string => {
    if (parts.length === 0) return "";
    if (parts.length === 1) return parts[0] ?? "";
    const [head, ...rest] = parts;
    return `${head} {\n        data {\n          ${buildNested(
      rest
    )}\n        }\n      }`;
  };

  const relationSelections = Array.from(relationToSubpaths.entries()).map(
    ([relation, subpaths]) => {
      const nested = Array.from(subpaths)
        .map((sf) => buildNested(sf.split(".")))
        .join("\n");
      return `${relation} {\n        data {\n          ${nested}\n        }\n      }`;
    }
  );

  return [...Array.from(simpleFields), ...relationSelections].join("\n");
};

export const upsertEntityInstance = async ({
  entityName,
  input,
  returnFields = ["id"],
  isUpdateForSeachValueRequests = false,
  client,
  headers,
}: {
  entityName: string;
  input: object;
  returnFields?: Array<string>;
  isUpdateForSeachValueRequests?: boolean;
  client: GraphQLClient;
  headers?: Record<string, string>;
}) => {
  const isUpdate = isUpdateForSeachValueRequests || "id" in input;

  // Build selection set from dotted returnFields, wrapping relations with `data`
  const buildSelectionFromFields = (fields?: Array<string>): string => {
    if (!fields || fields.length === 0) return "id";

    type Node = { children: Map<string, Node>; leaves: Set<string> };
    const createNode = (): Node => ({ children: new Map(), leaves: new Set() });
    const root: Node = createNode();

    for (const raw of fields) {
      const parts = raw
        .split(".")
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length === 0) continue;

      let node = root;
      for (let i = 0; i < parts.length; i++) {
        const seg = parts[i];
        if (!seg) continue;

        const isLast = i === parts.length - 1;
        if (isLast) {
          // Final segment -> leaf field on current node
          node.leaves.add(seg);
        } else {
          // Relation segment -> descend/create
          if (!node.children.has(seg)) node.children.set(seg, createNode());
          node = node.children.get(seg)!;
        }
      }
    }

    const indent = (text: string, spaces: number) =>
      text
        .split("\n")
        .map((l) => (l ? " ".repeat(spaces) + l : l))
        .join("\n");

    const emit = (node: Node): string => {
      const leafLines = Array.from(node.leaves).join("\n");
      const childLines = Array.from(node.children.entries()).map(([k, n]) => {
        const inner = emit(n);
        return `${k} {\n  data {\n${indent(inner, 4)}\n  }\n}`;
      });
      return [leafLines, ...childLines].filter(Boolean).join("\n");
    };

    const output = emit(root).trim();
    return output || "id";
  };

  const selectionSet = buildSelectionFromFields(returnFields);

  const upsertMutationDocument = gql`
  mutation ${isUpdate ? "update" : "create"}${capitalizeFirstLetter(
    entityName
  )}($input: ${isUpdate ? "Update" : "Create"}${capitalizeFirstLetter(
    entityName
  )}Input!) {
    ${isUpdate ? "update" : "create"}${capitalizeFirstLetter(
    entityName
  )}(input: $input) {
      data {
        ${selectionSet}
      }
    }
  }
  `;

  const updateEntityInstance = (await client.request(upsertMutationDocument, {
    input,
  }, headers)) as {
    [key: typeof entityName]: { data: { id: string } };
  };

  return {
    data: updateEntityInstance[
      `${isUpdate ? "update" : "create"}${capitalizeFirstLetter(entityName)}`
    ]?.data,
    entityInstanceId:
      updateEntityInstance[
        `${isUpdate ? "update" : "create"}${capitalizeFirstLetter(entityName)}`
      ]?.data.id,
    entityName,
  };
};

export interface FilterInput {
  sortby?: Array<SortInput>;
  query?: Array<QueryInput>;
}

export interface QueryInput {
  and?: Array<QueryInput>;
  condition?: {
    field: string;
    operator: FilterOperatorsType;
    value?: string;
    values?: Array<string>;
  };
  or?: Array<QueryInput>;
}

export interface PaginationInput {
  page: number;
  per_page: number;
}

export interface SortInput {
  field: string;
  order: "asc" | "desc";
}

// basic version without relations and pagination for relations
export const getEntityInstanceList = async <T = object>({
  entityName,
  paginationInput = { page: 1, per_page: 20 },
  filter = {},
  fieldsToFetch = ["id"],
  client,
  headers,
}: {
  entityName: string;
  paginationInput?: PaginationInput;
  filter?: FilterInput;
  fieldsToFetch?: Array<string>;
  client: GraphQLClient;
  headers?: Record<string, string>;
}): Promise<{
  entityInstances: Array<T>;
  pagination: PaginationData;
}> => {
  try {
    const lowerCaseEntityName = ensureFirstLetterLowercase(entityName);

    const selectionSet = buildNestedDataFieldsForRelations(fieldsToFetch);

    const queryDocument = gql`
      query ${lowerCaseEntityName}List($filter: FilterInput!, $pagination: PaginationInput!) {
        ${lowerCaseEntityName}List(filter: $filter, pagination: $pagination) {
          data {
            ${selectionSet}
          }
          ${paginationDataStr}
        }
      }
    `;

    const entityInstances = (await client.request(queryDocument, {
      filter,
      pagination: paginationInput,
    }, headers)) as {
      [key: typeof lowerCaseEntityName]: {
        data: Array<T>;
        pagination: { current_page: number; has_more_pages: boolean };
      };
    };

    const entityInstancesData =
      entityInstances[`${lowerCaseEntityName}List`]?.data;

    if (!entityInstancesData) {
      throw new Error("no entity instances found");
    }

    return {
      entityInstances: entityInstancesData || [],
      pagination: entityInstances[`${lowerCaseEntityName}List`]
        ?.pagination as PaginationData,
    };
  } catch (error) {
    console.error("error getting entity instance list", error);
    throw error;
  }
};

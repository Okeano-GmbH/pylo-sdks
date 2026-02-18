// Shared types used by both codegen output and runtime SDK.
// These never change per schema.

export type QueryOperator =
  | "equal"
  | "notEqual"
  | "greaterThan"
  | "lessThan"
  | "greaterThanOrEqual"
  | "lessThanOrEqual"
  | "isNull"
  | "isNotNull"
  | "like"
  | "notLike"
  | "ilike"
  | "notiLike"
  | "regex"
  | "notRegex"
  | "iregex"
  | "notiRegex"
  | "in"
  | "notIn"
  | "isEmpty"
  | "isNotEmpty"
  | "isTrue"
  | "isFalse";

export type SortOrder = "asc" | "desc";

export interface QueryInputCondition {
  field: string;
  operator: QueryOperator;
  value?: string | number;
  values?: Array<string | number>;
}

export interface QueryInput {
  and?: QueryInput[];
  or?: QueryInput[];
  condition?: QueryInputCondition;
}

export interface SortInput {
  field: string;
  order: SortOrder;
}

export interface FilterInput {
  query?: QueryInput[];
  sortby?: SortInput[];
}

export interface PaginationInput {
  page?: number;
  per_page?: number;
}

export interface PaginationData {
  total: number;
  current_page: number;
  per_page: number;
  last_page: number;
  has_more_pages: boolean;
}

export interface SearchValueInput {
  field: string;
  value?: string;
  not_found_behavior?: "create" | "skip" | "error";
  search_in_all_field_variants?: boolean;
  multiple_results_allowed?: boolean;
  multiple_results_use_latest?: boolean;
}

export interface EntityMetadata {
  pascalName: string;
  scalarFieldNames: string[];
  relations: Record<
    string,
    {
      type: "hasOne" | "hasMany";
      entity: string;
      pascalName: string;
    }
  >;
}

export interface SchemaMetadata {
  entities: Record<string, EntityMetadata>;
}

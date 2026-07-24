export const FilterOperators = [
  "equal",
  "notEqual",
  "greaterThan",
  "lessThan",
  "greaterThanOrEqual",
  "lessThanOrEqual",
  "isNull",
  "isNotNull",
  "isEmpty",
  "isNotEmpty",
  "isTrue",
  "isFalse",
  "like",
  "ilike",
  "notiLike",
  "notLike",
  "in",
  "notIn",
  "startsWith",
  "endsWith",
  "contains",
] as const;

export type FilterOperatorsType = (typeof FilterOperators)[number];

export interface QueryCondition {
  condition?: SingleCondition;
  and?: QueryCondition[];
  or?: QueryCondition[];
}

export interface SingleCondition {
  field: string;
  operator: FilterOperatorsType;
  value: string | number;
}

export function evaluateConditionTree(
  tree: QueryCondition | Array<QueryCondition>,
  variables: Record<string, any>
): boolean {
  if (typeof tree !== "object") {
    throw new Error("tree is not an object");
  }

  if (!tree) return true;

  if (Array.isArray(tree)) {
    if (!tree.length) return true;
    return tree.every((sub) => evaluateConditionTree(sub, variables));
  }

  if (tree.and) {
    return tree.and.every((sub) => evaluateConditionTree(sub, variables));
  }
  if (tree.or) {
    return tree.or.some((sub) => evaluateConditionTree(sub, variables));
  }
  if (tree.condition) {
    const { field, operator, value } = tree.condition;
    const fieldValue = getNestedValue(variables, field);
    return evaluateOperator(fieldValue, operator, value);
  }

  return true;
}

type OrderingOperator =
  | "greaterThan"
  | "lessThan"
  | "greaterThanOrEqual"
  | "lessThanOrEqual";

/** ISO date or date-time. Anchored, so a plain value like "10" never matches. */
const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}(?:([T ])\d{2}:\d{2}:\d{2}(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** Epoch millis for an ISO date/date-time string, else undefined. */
function toInstant(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;

  const match = ISO_DATE.exec(value);
  if (!match) return undefined;

  // A date-only value already parses as UTC, but a date-time with no zone would
  // parse as local time — pin it to UTC so results don't vary by host timezone.
  const [, time, zone] = match;
  const instant = Date.parse(
    value.replace(" ", "T") + (time && !zone ? "Z" : "")
  );

  return Number.isNaN(instant) ? undefined : instant;
}

/**
 * Orders two operands, as instants when both are ISO date strings and raw
 * otherwise. Without this, dates order lexicographically, so "2026-07-23" is
 * not >= "2026-07-23T00:00:00.000Z" despite being the same moment.
 */
function compareOrder(
  a: unknown,
  b: unknown,
  operator: OrderingOperator
): boolean {
  const instantA = toInstant(a);
  const instantB = toInstant(b);
  const [x, y]: [any, any] =
    instantA !== undefined && instantB !== undefined
      ? [instantA, instantB]
      : [a, b];

  switch (operator) {
    case "greaterThan":
      return x > y;
    case "lessThan":
      return x < y;
    case "greaterThanOrEqual":
      return x >= y;
    case "lessThanOrEqual":
      return x <= y;
  }
}

function evaluateOperator(
  fieldValue: any,
  operator: FilterOperatorsType,
  value: any
): boolean {
  const op = (a: any) => {
    switch (operator) {
      case "equal":
        return a === value;
      case "notEqual":
        return a !== value;
      case "greaterThan":
      case "lessThan":
      case "greaterThanOrEqual":
      case "lessThanOrEqual":
        return compareOrder(a, value, operator);
      case "isNull":
        return a == null;
      case "isNotNull":
        return a != null;
      case "like":
        return (
          typeof a === "string" &&
          typeof value === "string" &&
          a.includes(value)
        );
      case "ilike":
        return (
          typeof a === "string" &&
          typeof value === "string" &&
          a.toLowerCase().includes(value.toLowerCase())
        );
      case "notLike":
        return (
          typeof a === "string" &&
          typeof value === "string" &&
          !a.includes(value)
        );
      case "notiLike":
        return (
          typeof a === "string" &&
          typeof value === "string" &&
          !a.toLowerCase().includes(value.toLowerCase())
        );
      case "in":
        return Array.isArray(value) ? value.includes(a) : false;
      case "notIn":
        return Array.isArray(value) ? !value.includes(a) : false;
      case "startsWith":
        return (
          typeof a === "string" &&
          typeof value === "string" &&
          a.startsWith(value)
        );
      case "endsWith":
        return (
          typeof a === "string" &&
          typeof value === "string" &&
          a.endsWith(value)
        );
      case "contains":
        return Array.isArray(a)
          ? a.includes(value)
          : typeof a === "string" &&
              typeof value === "string" &&
              a.includes(value);
      case "isTrue":
        return a === true;
      case "isFalse":
        return !a;
      case "isEmpty":
        return isEmpty(a);
      case "isNotEmpty":
        return !isEmpty(a);
      default:
        return false;
    }
  };
  if (Array.isArray(fieldValue)) {
    return fieldValue.some(op);
  }
  return op(fieldValue);
}

function getNestedValue(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (Array.isArray(current)) {
      // Collect the property from all items in the array
      current = current.map((item) =>
        item && typeof item === "object" ? item[part] : undefined
      );
      // Flatten if the result is an array of arrays
      if (current.some(Array.isArray)) {
        current = current.flat();
      }
    } else if (current && typeof current === "object") {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function isEmpty(value: any): boolean {
  // null or undefined
  if (value == null) return true;

  // string
  if (typeof value === "string") {
    return value.trim().length === 0; // use .length === 0 if you don't want trim
  }

  // array
  if (Array.isArray(value)) {
    return value.length === 0;
  }

  // Map / Set
  if (value instanceof Map || value instanceof Set) {
    return value.size === 0;
  }

  // plain object
  if (typeof value === "object") {
    return Object.keys(value).length === 0;
  }

  // numbers, booleans, functions, etc. are not "empty"
  return false;
}

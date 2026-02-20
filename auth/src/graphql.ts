import type {
  GraphQLResponse,
  GraphQLError,
  CustomGraphQLError,
} from "./types.js";

export const DEFAULT_GRAPHQL_ENDPOINT = "https://api.pyloapp.com/graphql";

/**
 * Extract error message from GraphQL response errors
 */
export function extractErrorMessage(
  errors: GraphQLError[] | CustomGraphQLError | undefined
): string | null {
  if (!errors) return null;

  if (Array.isArray(errors) && errors.length > 0) {
    return errors[0]?.message ?? null;
  }

  if (typeof errors === "object" && "generalError" in errors) {
    return errors.generalError?.message ?? null;
  }

  return null;
}

/**
 * Check if response has errors
 */
export function hasErrors(response: GraphQLResponse<unknown>): boolean {
  return extractErrorMessage(response.errors) !== null;
}

/**
 * Check if the error is an authentication error
 */
export function isUnauthorizedError(response: GraphQLResponse<unknown>): boolean {
  const errors = response.errors;
  if (!errors) return false;

  const authErrorPatterns = [
    "unauthorized",
    "unauthenticated",
    "not authenticated",
    "expired token",
    "token expired",
    "invalid token",
    "jwt expired",
  ];

  const authCodePatterns = [
    "unauthenticated",
    "authenticationexception",
  ];

  if (Array.isArray(errors)) {
    return errors.some((e) => {
      const msg = e.message?.toLowerCase() ?? "";
      const code = e.extensions?.code?.toLowerCase() ?? "";
      return (
        authCodePatterns.some((pattern) => code.includes(pattern)) ||
        authErrorPatterns.some((pattern) => msg.includes(pattern))
      );
    });
  }

  if (typeof errors === "object" && "generalError" in errors) {
    const msg = errors.generalError?.message?.toLowerCase() ?? "";
    const code = errors.generalError?.errorCode?.toLowerCase() ?? "";
    return (
      authCodePatterns.some((pattern) => code.includes(pattern)) ||
      authErrorPatterns.some((pattern) => msg.includes(pattern))
    );
  }

  return false;
}

export function mergeHeaders(
  global?: Record<string, string>,
  perOp?: Record<string, string>,
): Record<string, string> | undefined {
  if (!global && !perOp) return undefined;
  return { ...global, ...perOp };
}

const PROTECTED_HEADERS = new Set(["authorization", "pylo-api-key", "content-type"]);

function stripProtectedHeaders(
  custom: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(custom)) {
    if (!PROTECTED_HEADERS.has(key.toLowerCase())) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Make a GraphQL request
 */
export async function graphqlRequest<T>(
  endpoint: string,
  query: string,
  variables?: Record<string, unknown>,
  options?: { token?: string; apiKey?: string; headers?: Record<string, string> }
): Promise<GraphQLResponse<T>> {
  const headers: Record<string, string> = {
    ...(options?.headers ? stripProtectedHeaders(options.headers) : {}),
    "Content-Type": "application/json",
  };

  if (options?.token) {
    headers["Authorization"] = `Bearer ${options.token}`;
  }

  if (options?.apiKey) {
    headers["pylo-api-key"] = options.apiKey;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });

  return response.json() as Promise<GraphQLResponse<T>>;
}

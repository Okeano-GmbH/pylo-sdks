import type {
  GraphQLResponse,
  GraphQLError,
  CustomGraphQLError,
  PyloErrorCode,
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
 * Extract the API's error classification (`extensions.code`) from a response's
 * errors. The API sets this for every error it raises, which is more reliable
 * than matching on the message text.
 */
export function extractErrorCode(
  errors: GraphQLError[] | CustomGraphQLError | undefined
): PyloErrorCode | string | null {
  if (!errors) return null;

  if (Array.isArray(errors)) {
    return errors[0]?.extensions?.code ?? null;
  }

  if (typeof errors === "object" && "generalError" in errors) {
    return errors.generalError?.errorCode ?? null;
  }

  return null;
}

/**
 * The HTTP status behind an error, for the responses `graphqlRequest`
 * synthesized itself. Absent on errors the API returned in its own envelope.
 */
export function extractHttpStatus(
  errors: GraphQLError[] | CustomGraphQLError | undefined
): number | null {
  if (!Array.isArray(errors)) return null;
  return errors[0]?.extensions?.httpStatus ?? null;
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

  // A synthesized error carries no message to match on. Only 401 counts: a 403
  // from a proxy in front of the API must not end the caller's session.
  if (extractHttpStatus(errors) === 401) return true;

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

const MAX_BODY_EXCERPT = 200;

const truncate = (body: string) =>
  body.length <= MAX_BODY_EXCERPT ? body : `${body.slice(0, MAX_BODY_EXCERPT)}…`;

function synthesizeError<T>(message: string, httpStatus: number): GraphQLResponse<T> {
  const code: PyloErrorCode = ((): PyloErrorCode => {
    if (httpStatus === 401) return "UNAUTHENTICATED";
    if (httpStatus === 403) return "FORBIDDEN";
    return "NETWORK_ERROR";
  })();

  return { errors: [{ message, extensions: { code, httpStatus } }] };
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

  const body = await response.text();

  let parsed: GraphQLResponse<T> | undefined;
  try {
    parsed = JSON.parse(body) as GraphQLResponse<T>;
  } catch {
    parsed = undefined;
  }

  // The API answers every error with its own `errors` envelope, so anything
  // unparseable came from in front of it (a proxy's HTML 502, a gateway
  // timeout). Callers branch on `hasErrors`/`isUnauthorizedError`, so report it
  // in the same shape rather than throwing past them.
  if (parsed === undefined) {
    return synthesizeError(
      `Pylo returned a non-JSON response (HTTP ${response.status})${body === "" ? "" : `: ${truncate(body)}`}`,
      response.status,
    );
  }

  // A non-2xx with a well-formed envelope is the API reporting an error it
  // classified itself (401 UNAUTHENTICATED, for one) — leave it as it is.
  if (!response.ok && !hasErrors(parsed)) {
    return synthesizeError(
      `Pylo request failed (HTTP ${response.status})${body === "" ? "" : `: ${truncate(body)}`}`,
      response.status,
    );
  }

  return parsed;
}

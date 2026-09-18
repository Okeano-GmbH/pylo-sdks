import {
  graphqlRequest,
  hasErrors,
  extractErrorMessage,
  isUnauthorizedError,
} from "@pylo/auth";
import { PyloError } from "@pylo/core";

/**
 * How the hooks reach the API. `@pylo/react` talks to it directly; `@pylo/nextjs`
 * posts to its route handler so the token can stay in an httpOnly cookie.
 */
export type Transport = (
  query: string,
  variables: Record<string, unknown>,
  headers?: Record<string, string>,
) => Promise<unknown>;

export interface DirectTransportOptions {
  endpoint: string;
  getToken: () => Promise<string | null>;
  /** Called once on an unauthorized response; returns the token to retry with. */
  onUnauthorized?: () => Promise<string | null>;
}

export function createDirectTransport(options: DirectTransportOptions): Transport {
  function send(
    query: string,
    variables: Record<string, unknown>,
    headers: Record<string, string> | undefined,
    token: string | null,
  ) {
    return graphqlRequest<Record<string, unknown>>(
      options.endpoint,
      query,
      variables,
      {
        ...(token !== null ? { token } : {}),
        ...(headers !== undefined ? { headers } : {}),
      },
    );
  }

  return async (query, variables, headers) => {
    let response = await send(query, variables, headers, await options.getToken());

    // A token can expire between the freshness check and the request landing.
    // One refresh and one retry turns that into a hiccup rather than an error
    // every caller has to handle.
    if (isUnauthorizedError(response) && options.onUnauthorized) {
      const token = await options.onUnauthorized();
      if (token !== null) {
        response = await send(query, variables, headers, token);
      }
    }

    if (hasErrors(response)) {
      throw new PyloError(
        extractErrorMessage(response.errors) ?? "GraphQL request failed",
        response.errors,
      );
    }

    if (!response.data) {
      throw new PyloError("No data returned from GraphQL request");
    }

    return response.data;
  };
}

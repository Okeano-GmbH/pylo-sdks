"use client";

import { createRealtime, PyloError } from "@pylo/core";
import type { GraphQLError } from "@pylo/auth";
import { createPyloHooks as createSharedHooks } from "@pylo/react";
import type { LiveRealtime, Transport } from "@pylo/react";

export type { Transport } from "@pylo/react";

interface HooksOptions {
  apiPath?: string;
  /** The route `createPyloWsTokenRoute` is mounted on. */
  wsTokenPath?: string;
  headers?: Record<string, string>;
}

/**
 * Fetches the access token for the realtime socket from the route
 * `createPyloWsTokenRoute` is mounted on. Pass it as `auth` to `createRealtime`;
 * the browser never holds the token otherwise.
 */
export async function fetchWsToken(
  path = "/api/pylo/ws-token",
): Promise<{ token?: string }> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) return {};
  const body = (await response.json()) as { token?: string };
  return body.token ? { token: body.token } : {};
}

/**
 * Posts to the app's own route handler rather than the API, so the token stays
 * in an httpOnly cookie and never reaches client JavaScript. Failures throw a
 * `PyloError` carrying `httpStatus` and `code`; see `isPyloUnauthorized`.
 */
export function createApiRouteTransport(apiPath = "/api/graphql"): Transport {
  return async (query, variables, headers) => {
    const response = await fetch(apiPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        variables,
        ...(headers !== undefined ? { headers } : {}),
      }),
    });

    if (!response.ok) {
      const message = `GraphQL request failed: ${response.status} ${response.statusText}`;
      const body = (await response.json().catch(() => null)) as {
        errors?: GraphQLError[];
      } | null;
      const errors = body?.errors?.length ? body.errors : [{ message }];
      throw new PyloError(
        message,
        errors.map((e) => ({
          ...e,
          extensions: { ...e.extensions, httpStatus: response.status },
        })),
      );
    }

    const json = (await response.json()) as {
      data?: unknown;
      errors?: GraphQLError[];
    };

    if (json.errors?.length) {
      throw new PyloError(json.errors.map((e) => e.message).join(", "), json.errors);
    }

    return json.data;
  };
}

export function createPyloHooks<S>(options?: HooksOptions) {
  // Static for the app's lifetime, so this "hook" ignores context entirely and
  // the package still needs no provider.
  const transport = createApiRouteTransport(options?.apiPath ?? "/api/graphql");
  const wsTokenPath = options?.wsTokenPath ?? "/api/pylo/ws-token";
  let realtime: LiveRealtime | undefined;
  // Created on first use in the browser; on the server `live` hooks render
  // like plain ones, and effects never run there anyway.
  const useRealtime = (): LiveRealtime | null => {
    if (typeof window === "undefined") return null;
    realtime ??= {
      client: createRealtime({
        request: (query, variables) => transport(query, variables),
        auth: () => fetchWsToken(wsTokenPath),
      }),
      liveQueries: new Map(),
    };
    return realtime;
  };

  return createSharedHooks<S>({
    useTransport: () => transport,
    useRealtime,
    ...(options?.headers !== undefined ? { headers: options.headers } : {}),
  });
}

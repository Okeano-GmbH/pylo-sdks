"use client";

import { createPyloHooks as createSharedHooks } from "@pylo/react";
import type { Transport } from "@pylo/react";

interface HooksOptions {
  apiPath?: string;
  headers?: Record<string, string>;
}

/**
 * Posts to the app's own route handler rather than the API, so the token stays
 * in an httpOnly cookie and never reaches client JavaScript. Errors keep the
 * shape this package has always thrown.
 */
function createApiRouteTransport(apiPath: string): Transport {
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
      throw new Error(
        `GraphQL request failed: ${response.status} ${response.statusText}`,
      );
    }

    const json = (await response.json()) as {
      data?: unknown;
      errors?: Array<{ message: string }>;
    };

    if (json.errors?.length) {
      throw new Error(json.errors.map((e) => e.message).join(", "));
    }

    return json.data;
  };
}

export function createPyloHooks<S>(options?: HooksOptions) {
  // Static for the app's lifetime, so this "hook" ignores context entirely and
  // the package still needs no provider.
  const transport = createApiRouteTransport(options?.apiPath ?? "/api/graphql");

  return createSharedHooks<S>({
    useTransport: () => transport,
    ...(options?.headers !== undefined ? { headers: options.headers } : {}),
  });
}

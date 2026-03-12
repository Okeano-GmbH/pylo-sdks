import { createPyloClient, PyloError } from "@pylo/core";
import type { PyloClient, SchemaMetadata } from "@pylo/core";
import { getAuthToken } from "@pylo/auth-nextjs/core";

interface ServerOptions {
  endpoint?: string;
  schemaMetadata: SchemaMetadata;
  apiKey?: string;
  headers?: Record<string, string>;
}

export type PyloServer<S> = PyloClient<S>;

export function createPyloServer<S>(options: ServerOptions): PyloServer<S> {
  const auth = options.apiKey
    ? async () => ({ apiKey: options.apiKey! })
    : async () => {
        const token = await getAuthToken();
        if (!token) throw new PyloError("Not authenticated — no auth token found");
        return { token };
      };

  return createPyloClient<S>({
    ...(options.endpoint !== undefined ? { endpoint: options.endpoint } : {}),
    schemaMetadata: options.schemaMetadata,
    auth,
    ...(options.headers !== undefined ? { headers: options.headers } : {}),
  });
}

export { PyloError } from "@pylo/core";

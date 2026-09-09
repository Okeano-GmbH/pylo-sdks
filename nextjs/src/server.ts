import { createPyloClient, PyloError } from "@pylo/core";
import type { PyloClient } from "@pylo/core";
import type { RegisteredDocumentTemplates } from "./index.js";
import { getAuthToken } from "@pylo/auth-nextjs/core";

interface ServerOptions {
  endpoint?: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

export type PyloServer<S, T = RegisteredDocumentTemplates> = PyloClient<S, T>;

export function createPyloServer<S, T = RegisteredDocumentTemplates>(
  options: ServerOptions,
): PyloServer<S, T> {
  const auth = options.apiKey
    ? async () => ({ apiKey: options.apiKey! })
    : async () => {
        const token = await getAuthToken();
        if (!token) throw new PyloError("Not authenticated — no auth token found");
        return { token };
      };

  return createPyloClient<S, T>({
    ...(options.endpoint !== undefined ? { endpoint: options.endpoint } : {}),
    auth,
    ...(options.headers !== undefined ? { headers: options.headers } : {}),
  });
}

export { PyloError } from "@pylo/core";

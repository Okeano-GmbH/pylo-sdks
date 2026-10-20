import {
  graphqlRequest,
  DEFAULT_GRAPHQL_ENDPOINT,
  hasErrors,
} from "@pylo/auth";
import { getAuthToken } from "@pylo/auth-nextjs/core";

interface ApiRouteOptions {
  endpoint?: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

interface RequestBody {
  query?: string;
  variables?: Record<string, unknown>;
  headers?: Record<string, string>;
}

function getEndpoint(options?: ApiRouteOptions): string {
  if (options?.endpoint) return options.endpoint;
  return process.env["PYLO_GRAPHQL_ENDPOINT"] ?? DEFAULT_GRAPHQL_ENDPOINT;
}

export function createPyloApiRoute(options?: ApiRouteOptions) {
  const endpoint = getEndpoint(options);

  async function POST(request: Request): Promise<Response> {
    let authOptions: { token?: string; apiKey?: string };

    if (options?.apiKey) {
      authOptions = { apiKey: options.apiKey };
    } else {
      const token = await getAuthToken();
      if (!token) {
        return Response.json(
          { errors: [{ message: "Unauthorized" }] },
          { status: 401 },
        );
      }
      authOptions = { token };
    }

    let body: RequestBody;
    try {
      body = (await request.json()) as RequestBody;
    } catch {
      return Response.json(
        { errors: [{ message: "Invalid request body" }] },
        { status: 400 },
      );
    }

    if (!body.query || typeof body.query !== "string") {
      return Response.json(
        { errors: [{ message: "Missing or invalid 'query' field" }] },
        { status: 400 },
      );
    }

    const mergedHeaders = { ...options?.headers, ...body.headers };
    const hasHeaders = Object.keys(mergedHeaders).length > 0;

    try {
      const result = await graphqlRequest(
        endpoint,
        body.query,
        body.variables,
        { ...authOptions, ...(hasHeaders ? { headers: mergedHeaders } : {}) },
      );

      if (hasErrors(result)) {
        return Response.json(result, { status: 200 });
      }

      return Response.json(result);
    } catch {
      return Response.json(
        { errors: [{ message: "Internal server error" }] },
        { status: 500 },
      );
    }
  }

  return { POST };
}

/**
 * Hands the session's access token to the browser for the realtime socket,
 * which authenticates with it and keeps it to fetch every event under the
 * user's permissions. Mount it under a path the Pylo proxy runs on — not
 * `/api/auth/*`, which the matcher excludes, so the token would never be
 * refreshed there. The refresh token stays in its httpOnly cookie.
 *
 * ```ts
 * // app/api/pylo/ws-token/route.ts
 * export const { GET } = createPyloWsTokenRoute();
 * ```
 */
export function createPyloWsTokenRoute() {
  async function GET(): Promise<Response> {
    const token = await getAuthToken();
    if (!token) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return Response.json({ token }, { headers: { "Cache-Control": "no-store" } });
  }

  return { GET };
}

import {
  graphqlRequest,
  DEFAULT_GRAPHQL_ENDPOINT,
  hasErrors,
} from "@pylo/auth";
import { getAuthToken } from "@pylo/auth-nextjs/core";

interface ApiRouteOptions {
  endpoint?: string;
}

interface RequestBody {
  query?: string;
  variables?: Record<string, unknown>;
}

function getEndpoint(options?: ApiRouteOptions): string {
  if (options?.endpoint) return options.endpoint;
  return process.env["PYLO_GRAPHQL_ENDPOINT"] ?? DEFAULT_GRAPHQL_ENDPOINT;
}

export function createPyloApiRoute(options?: ApiRouteOptions) {
  const endpoint = getEndpoint(options);

  async function POST(request: Request): Promise<Response> {
    const token = await getAuthToken();
    if (!token) {
      return Response.json(
        { errors: [{ message: "Unauthorized" }] },
        { status: 401 },
      );
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

    try {
      const result = await graphqlRequest(
        endpoint,
        body.query,
        body.variables,
        { token },
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

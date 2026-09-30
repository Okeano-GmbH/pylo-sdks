import { graphqlRequest } from "@pylo/auth";
import type { SchemaFetcher } from "./fetch-schema.js";
import type { ResolvedPyloConfig } from "./config.js";

export const SOCIAL_BINDINGS_QUERY = `
query PyloSocialBindingsFetch($filter: FilterInput, $pagination: PaginationInput) {
  pyloAppAuthProviderList(filter: $filter, pagination: $pagination) {
    data {
      return_urls
      is_enabled
      pylo_auth_provider {
        data {
          provider
        }
      }
    }
    pagination {
      total
      has_more_pages
      current_page
    }
  }
}
`;

export interface RawSocialBinding {
  // A jsonb column, so it arrives as a JSON string.
  return_urls: string | string[] | null;
  is_enabled: boolean | null;
  pylo_auth_provider: { data: { provider: string } | null } | null;
}

interface SocialBindingListResponse {
  pyloAppAuthProviderList: {
    data: RawSocialBinding[];
    pagination: {
      total: number;
      has_more_pages: boolean;
      current_page: number;
    };
  };
}

function socialFetchError(appId: string, message: string): Error {
  return new Error(`Failed to fetch sign-in providers for app ${appId}: ${message}`);
}

export interface SocialBindings {
  providers: string[];
  returnUrls: string[];
}

function parseReturnUrls(value: RawSocialBinding["return_urls"]): string[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((u) => typeof u === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Read the sign-in providers enabled for one app and the return URLs they
 * allow. Unlike the template fetch this throws: `appId` is an explicit opt-in
 * to narrowing, so silently falling back to wide types would defeat it.
 */
export async function fetchSocialBindingsWith(
  request: SchemaFetcher,
  appId: string,
): Promise<SocialBindings> {
  const providers = new Set<string>();
  const returnUrls = new Set<string>();
  const filter = {
    query: [{ condition: { field: "pylo_app.id", operator: "equal", value: appId } }],
  };
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    let response;
    try {
      response = await request<SocialBindingListResponse>(SOCIAL_BINDINGS_QUERY, {
        filter,
        pagination: { page, per_page: 50 },
      });
    } catch (err) {
      throw socialFetchError(appId, err instanceof Error ? err.message : String(err));
    }

    if (response.errors || !response.data?.pyloAppAuthProviderList) {
      const message = Array.isArray(response.errors)
        ? response.errors.map((e) => e.message).join(", ")
        : response.errors?.generalError?.message ?? "endpoint unavailable";
      throw socialFetchError(appId, message);
    }

    const { data, pagination } = response.data.pyloAppAuthProviderList;
    for (const binding of data) {
      const provider = binding.pylo_auth_provider?.data?.provider;
      if (!binding.is_enabled || !provider) continue;
      providers.add(provider);
      for (const url of parseReturnUrls(binding.return_urls)) returnUrls.add(url);
    }
    hasMore = pagination.has_more_pages;
    page++;
  }

  return { providers: [...providers], returnUrls: [...returnUrls] };
}

export async function fetchSocialBindings(
  config: ResolvedPyloConfig & { appId: string },
): Promise<SocialBindings> {
  return fetchSocialBindingsWith(
    (query, variables) =>
      graphqlRequest(config.endpoint, query, variables, { apiKey: config.apiKey }),
    config.appId,
  );
}

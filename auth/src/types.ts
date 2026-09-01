/**
 * Pylo user object returned from the API
 */
export interface PyloUser {
  id: string;
  email: string;
}

/**
 * Configuration options for Pylo Auth
 */
export interface PyloAuthConfig {
  /** GraphQL API endpoint. Default: 'https://api.pyloapp.com/graphql' */
  graphqlEndpoint?: string;
  /** Seconds before token expiry to trigger refresh. Default: 60 */
  tokenRefreshBuffer?: number;
}

/**
 * Cookie configuration options
 */
export interface CookieOptions {
  /** Use HTTPS only. Default: true in production */
  secure?: boolean;
  /** CSRF protection setting. Default: 'lax' */
  sameSite?: "strict" | "lax" | "none";
  /** Cookie domain for cross-subdomain sharing */
  domain?: string;
  /** Cookie path. Default: '/' */
  path?: string;
  /** Auth token lifetime in seconds. Default: 3600 (1 hour) */
  authMaxAge?: number;
  /** Refresh token lifetime in seconds. Default: 604800 (7 days) */
  refreshMaxAge?: number;
}

/**
 * Authentication result returned from login/refresh operations
 */
export interface AuthResult {
  success: boolean;
  user?: PyloUser;
  authToken?: string;
  refreshToken?: string;
  error?: AuthError;
}

/**
 * Authentication error
 */
export interface AuthError {
  code: "INVALID_CREDENTIALS" | "TOKEN_EXPIRED" | "NETWORK_ERROR" | "SERVER_ERROR";
  message: string;
}

/**
 * JWT token payload
 */
export interface TokenPayload {
  sub: string;
  email?: string;
  exp: number;
  iat: number;
}

/**
 * GraphQL response structure
 */
export interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[] | CustomGraphQLError;
}

/**
 * Error codes the API sets on `extensions.code`. `NETWORK_ERROR` is the one the
 * SDK synthesizes itself, for a response that never reached the API intact.
 */
export type PyloErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "GRAPHQL_PARSE_FAILED"
  | "GRAPHQL_VALIDATION_FAILED"
  | "DATABASE_ERROR"
  | "INTERNAL_SERVER_ERROR"
  | "NETWORK_ERROR";

/**
 * Standard GraphQL error
 */
export interface GraphQLError {
  message: string;
  /** `httpStatus` is present only on errors the SDK synthesized from the response status. */
  extensions?: { code?: PyloErrorCode | string; httpStatus?: number };
}

/**
 * Custom Pylo GraphQL error format
 */
export interface CustomGraphQLError {
  referenceId?: string;
  generalError?: {
    errorCode?: PyloErrorCode | string;
    message?: string;
  };
}

/**
 * Login API response
 */
export interface LoginResponse {
  login: {
    data: {
      auth_token: string;
      refresh_token: string;
    };
  };
}

/**
 * Refresh token API response
 */
export interface RefreshTokenResponse {
  refreshToken: {
    data: {
      auth_token: string;
      refresh_token: string;
    };
  };
}

/**
 * Me query API response
 */
export interface MeResponse {
  me: {
    current_user: {
      data: PyloUser;
    };
  };
}

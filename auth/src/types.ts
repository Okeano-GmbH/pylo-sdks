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
  /** Optional Pylo App ID for multi-app setups */
  appId?: string;
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
 * Standard GraphQL error
 */
export interface GraphQLError {
  message: string;
  extensions?: { code?: string };
}

/**
 * Custom Pylo GraphQL error format
 */
export interface CustomGraphQLError {
  referenceId?: string;
  generalError?: {
    errorCode?: string;
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

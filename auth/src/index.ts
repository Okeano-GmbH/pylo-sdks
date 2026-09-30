// Types
export type {
  PyloUser,
  PyloAuthConfig,
  CookieOptions,
  AuthResult,
  AuthError,
  TokenPayload,
  ShouldRefreshTokenOptions,
  GraphQLResponse,
  GraphQLError,
  CustomGraphQLError,
  PyloErrorCode,
  LoginResponse,
  RefreshTokenResponse,
  MeResponse,
  SocialProvider,
  LoginHandoffResponse,
} from "./types.js";

// Token utilities
export { decodeToken, isTokenExpired, shouldRefreshToken } from "./token.js";

// GraphQL utilities
export {
  DEFAULT_GRAPHQL_ENDPOINT,
  extractErrorMessage,
  extractErrorCode,
  extractHttpStatus,
  hasErrors,
  isUnauthorizedError,
  graphqlRequest,
  mergeHeaders,
} from "./graphql.js";

// Mutations
export {
  LOGIN_MUTATION,
  REFRESH_TOKEN_MUTATION,
  REDEEM_LOGIN_HANDOFF_MUTATION,
  ME_QUERY,
} from "./mutations.js";

// Social login handoff
export type { HandoffCrypto } from "./handoff.js";
export {
  webHandoffCrypto,
  createHandoffVerifier,
  createHandoffChallenge,
  buildSocialStartUrl,
  parseHandoffCallback,
  safeRedirectPath,
} from "./handoff.js";

// Re-export everything from core auth package
export * from "@pylo/auth";

// Export Next.js specific types
export type {
  PyloAuthOptions,
  AuthContext,
  RequireAuthOptions,
} from "./types.js";

// Export error class
export { NotAuthenticatedError } from "./types.js";

// Middleware
export { pyloAuth, createPyloProxy } from "./middleware.js";

// Server utilities
export {
  getUser,
  loggedIn,
  requireAuth,
  login,
  logout,
  refreshTokens,
} from "./server.js";

// Cookie utilities
export {
  getAuthToken,
  getRefreshToken,
  setAuthCookies,
  clearAuthCookies,
  getAuthTokenCookieName,
  getRefreshTokenCookieName,
} from "./cookies.js";
